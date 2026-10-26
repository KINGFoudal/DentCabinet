import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { addMember, asUser, connect, createCabinet, createUser } from "./helpers";

/** Dossier patient : droits par rôle et règles imposées par la base. */

let db: Client;
let owner: { id: string }; // admin + dentiste
let dentist: { id: string };
let assistant: { id: string };
let accountant: { id: string };
let adminOnly: { id: string };
let outsider: { id: string };
let cab: string;
let otherCab: string;
let patient: string;
let signedNote: string;
let draftNote: string;
let adminDoc: string;
let xrayDoc: string;

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

beforeAll(async () => {
  db = await connect();
  owner = await createUser(db);
  dentist = await createUser(db);
  assistant = await createUser(db);
  accountant = await createUser(db);
  adminOnly = await createUser(db);
  outsider = await createUser(db);
  cab = await createCabinet(db, owner.id);
  otherCab = await createCabinet(db, outsider.id);
  await addMember(db, cab, dentist.id, ["dentist"]);
  await addMember(db, cab, assistant.id, ["assistant"]);
  await addMember(db, cab, accountant.id, ["accountant"]);
  await addMember(db, cab, adminOnly.id, ["admin"]);

  await asUser(
    db,
    owner.id,
    async () => {
      const { rows } = await q(
        `insert into public.patients (cabinet_id, first_name, last_name, phone) values ($1, 'Aïssatou', 'Sylla', '+224621000001') returning id`,
        [cab],
      );
      patient = rows[0].id;
      await q(`insert into public.patient_medical (patient_id, cabinet_id, alerts, allergies) values ($1, $2, '{diabetes,anticoagulants}', 'Latex')`, [
        patient,
        cab,
      ]);
      signedNote = (
        await q(`insert into public.clinical_notes (cabinet_id, patient_id, author_id, body, signed_at) values ($1, $2, $3, 'Signée', now()) returning id`, [
          cab,
          patient,
          owner.id,
        ])
      ).rows[0].id;
      draftNote = (
        await q(`insert into public.clinical_notes (cabinet_id, patient_id, author_id, body) values ($1, $2, $3, 'Brouillon') returning id`, [
          cab,
          patient,
          owner.id,
        ])
      ).rows[0].id;
      adminDoc = randomUUID();
      xrayDoc = randomUUID();
      await q(
        `insert into public.documents (id, cabinet_id, patient_id, kind, title, storage_path) values
           ($1, $3, $4, 'administrative', 'Carte assurance', $5),
           ($2, $3, $4, 'xray', 'Panoramique', $6)`,
        [adminDoc, xrayDoc, cab, patient, `${cab}/${patient}/${adminDoc}-carte.jpg`, `${cab}/${patient}/${xrayDoc}-pano.jpg`],
      );
      await q(`insert into public.tooth_records (cabinet_id, patient_id, tooth, status, surfaces) values ($1, $2, 16, 'caries', '{O,D}')`, [cab, patient]);
      await q(`insert into public.prescriptions (cabinet_id, patient_id, dentist_id, items) values ($1, $2, $3, '[{"drug":"Amoxicilline"}]')`, [
        cab,
        patient,
        owner.id,
      ]);
    },
    true,
  );

  // Objets storage correspondant aux documents (créés hors RLS, comme après un téléversement).
  for (const id of [adminDoc, xrayDoc]) {
    await q(`insert into storage.objects (bucket_id, name, owner) select 'documents', storage_path, $2 from public.documents where id = $1`, [id, owner.id]);
  }
});

afterAll(async () => {
  await db.end();
});

const count = (userId: string, sql: string, params: unknown[] = []) =>
  asUser(db, userId, async () => (await q(sql, params)).rowCount ?? 0);

describe("notes cliniques", () => {
  it("le secrétariat et le comptable ne lisent pas les notes ; un autre praticien du cabinet oui", async () => {
    expect(await count(assistant.id, `select 1 from public.clinical_notes where patient_id = $1`, [patient])).toBe(0);
    expect(await count(accountant.id, `select 1 from public.clinical_notes where patient_id = $1`, [patient])).toBe(0);
    expect(await count(adminOnly.id, `select 1 from public.clinical_notes where patient_id = $1`, [patient])).toBe(0);
    expect(await count(dentist.id, `select 1 from public.clinical_notes where patient_id = $1`, [patient])).toBe(2);
  });

  it("le secrétariat ne peut pas écrire de note", async () => {
    await expect(
      asUser(db, assistant.id, () =>
        q(`insert into public.clinical_notes (cabinet_id, patient_id, author_id, body) values ($1, $2, $3, 'x')`, [cab, patient, assistant.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("une note signée n'est plus modifiable", async () => {
    await expect(
      asUser(db, owner.id, () => q(`update public.clinical_notes set body = 'Modifiée' where id = $1`, [signedNote])),
    ).rejects.toThrow(/signed note cannot be modified/);
    await expect(
      asUser(db, owner.id, () => q(`update public.clinical_notes set signed_at = null where id = $1`, [signedNote])),
    ).rejects.toThrow(/signed note cannot be modified/);
  });

  it("une note signée ne peut pas être supprimée (même logiquement)", async () => {
    await expect(
      asUser(db, owner.id, () => q(`update public.clinical_notes set deleted_at = now() where id = $1`, [signedNote])),
    ).rejects.toThrow(/signed note cannot be deleted/);
  });

  it("un brouillon reste modifiable par son auteur, pas par un autre praticien", async () => {
    expect(await count(owner.id, `update public.clinical_notes set body = 'Corrigé' where id = $1`, [draftNote])).toBe(1);
    expect(await count(dentist.id, `update public.clinical_notes set body = 'Pirate' where id = $1`, [draftNote])).toBe(0);
  });

  it("l'auteur peut signer son brouillon (upsert comme le moteur de synchronisation)", async () => {
    const n = await asUser(db, owner.id, async () => {
      await q(
        `insert into public.clinical_notes (id, cabinet_id, patient_id, author_id, body, signed_at) values ($1, $2, $3, $4, 'Brouillon', now())
         on conflict (id) do update set body = excluded.body, signed_at = excluded.signed_at`,
        [draftNote, cab, patient, owner.id],
      );
      return (await q(`select signed_at from public.clinical_notes where id = $1`, [draftNote])).rows[0].signed_at;
    });
    expect(n).not.toBeNull();
  });
});

describe("informations médicales", () => {
  it("lues par les praticiens et le secrétariat, pas par le comptable", async () => {
    expect(await count(assistant.id, `select 1 from public.patient_medical where patient_id = $1`, [patient])).toBe(1);
    expect(await count(dentist.id, `select 1 from public.patient_medical where patient_id = $1`, [patient])).toBe(1);
    expect(await count(accountant.id, `select 1 from public.patient_medical where patient_id = $1`, [patient])).toBe(0);
  });

  it("le secrétariat peut mettre à jour les alertes", async () => {
    expect(await count(assistant.id, `update public.patient_medical set alerts = '{pregnancy}' where patient_id = $1`, [patient])).toBe(1);
  });
});

describe("schéma dentaire, plans et ordonnances", () => {
  it("réservés aux praticiens", async () => {
    for (const table of ["tooth_records", "prescriptions"]) {
      expect(await count(assistant.id, `select 1 from public.${table} where patient_id = $1`, [patient])).toBe(0);
      expect(await count(accountant.id, `select 1 from public.${table} where patient_id = $1`, [patient])).toBe(0);
      expect(await count(dentist.id, `select 1 from public.${table} where patient_id = $1`, [patient])).toBe(1);
    }
    await expect(
      asUser(db, assistant.id, () =>
        q(`insert into public.treatment_plans (cabinet_id, patient_id, dentist_id, title) values ($1, $2, $3, 'Plan')`, [cab, patient, owner.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("une seule ligne par dent et numéros FDI valides uniquement", async () => {
    await expect(
      asUser(db, dentist.id, () => q(`insert into public.tooth_records (cabinet_id, patient_id, tooth, status) values ($1, $2, 16, 'filled')`, [cab, patient])),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      asUser(db, dentist.id, () => q(`insert into public.tooth_records (cabinet_id, patient_id, tooth) values ($1, $2, 19)`, [cab, patient])),
    ).rejects.toThrow(/check constraint/);
    expect(
      await count(dentist.id, `insert into public.tooth_records (cabinet_id, patient_id, tooth, status) values ($1, $2, 75, 'caries')`, [cab, patient]),
    ).toBe(1);
  });
});

describe("documents", () => {
  it("le secrétariat voit les documents administratifs mais pas les radios", async () => {
    const rows = await asUser(db, assistant.id, async () => (await q(`select id from public.documents where patient_id = $1`, [patient])).rows);
    expect(rows.map((r) => r.id)).toEqual([adminDoc]);
    const all = await asUser(db, dentist.id, async () => (await q(`select id from public.documents where patient_id = $1`, [patient])).rows);
    expect(all.map((r) => r.id).sort()).toEqual([adminDoc, xrayDoc].sort());
    expect(await count(accountant.id, `select 1 from public.documents where patient_id = $1`, [patient])).toBe(0);
  });

  it("le secrétariat ne peut pas déposer une radio, mais un document administratif oui", async () => {
    await expect(
      asUser(db, assistant.id, () =>
        q(`insert into public.documents (cabinet_id, patient_id, kind, title, storage_path) values ($1, $2, 'xray', 'R', 'x')`, [cab, patient]),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      await count(assistant.id, `insert into public.documents (cabinet_id, patient_id, kind, title, storage_path) values ($1, $2, 'administrative', 'A', $3)`, [
        cab,
        patient,
        `${cab}/${patient}/y`,
      ]),
    ).toBe(1);
  });

  it("le fichier storage suit les mêmes règles", async () => {
    const names = (userId: string) =>
      asUser(db, userId, async () => (await q(`select name from storage.objects where bucket_id = 'documents' and name like $1`, [`${cab}/${patient}/%`])).rows.length);
    expect(await names(assistant.id)).toBe(1);
    expect(await names(dentist.id)).toBe(2);
    expect(await names(accountant.id)).toBe(0);
    expect(await names(outsider.id)).toBe(0);
  });

  it("téléversement storage : membres du cabinet (hors comptable) dans le dossier de leur cabinet seulement", async () => {
    const upload = (userId: string, cabinet: string) =>
      asUser(db, userId, () =>
        q(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${cabinet}/${patient}/${randomUUID()}-f.jpg`]),
      );
    await expect(upload(assistant.id, cab)).resolves.toBeDefined();
    await expect(upload(accountant.id, cab)).rejects.toThrow(/row-level security/);
    await expect(upload(outsider.id, cab)).rejects.toThrow(/row-level security/);
  });
});

describe("archivage des patients", () => {
  it("réservé à l'administrateur", async () => {
    await expect(asUser(db, assistant.id, () => q(`update public.patients set deleted_at = now() where id = $1`, [patient]))).rejects.toThrow(
      /only an administrator can archive/,
    );
    await expect(asUser(db, dentist.id, () => q(`update public.patients set deleted_at = now() where id = $1`, [patient]))).rejects.toThrow(
      /only an administrator can archive/,
    );
    expect(await count(adminOnly.id, `update public.patients set deleted_at = now() where id = $1`, [patient])).toBe(1);
  });

  it("le secrétariat peut toujours modifier la fiche administrative", async () => {
    expect(await count(assistant.id, `update public.patients set city = 'Kankan', phone = '+224621000002' where id = $1`, [patient])).toBe(1);
  });

  it("restauration aussi réservée à l'administrateur", async () => {
    await asUser(db, owner.id, () => q(`update public.patients set deleted_at = now() where id = $1`, [patient]), true);
    try {
      await expect(asUser(db, assistant.id, () => q(`update public.patients set deleted_at = null where id = $1`, [patient]))).rejects.toThrow(
        /only an administrator can archive/,
      );
    } finally {
      await asUser(db, owner.id, () => q(`update public.patients set deleted_at = null where id = $1`, [patient]), true);
    }
  });

  it("le numéro de dossier est attribué par le serveur", async () => {
    const fileNumber = await asUser(db, assistant.id, async () => (await q(`select file_number from public.patients where id = $1`, [patient])).rows[0].file_number);
    expect(fileNumber).toMatch(/^P\d{4}-\d{5}$/);
  });
});

describe("journal des consultations", () => {
  it("log_patient_view trace l'ouverture du dossier par un membre", async () => {
    const before = (await q(`select count(*)::int as n from public.audit_log where patient_id = $1 and action = 'view'`, [patient])).rows[0].n;
    await asUser(db, assistant.id, () => q(`select public.log_patient_view($1)`, [patient]), true);
    const after = (await q(`select count(*)::int as n from public.audit_log where patient_id = $1 and action = 'view'`, [patient])).rows[0].n;
    expect(after).toBe(before + 1);
  });

  it("refusé à un utilisateur d'un autre cabinet", async () => {
    await expect(asUser(db, outsider.id, () => q(`select public.log_patient_view($1)`, [patient]))).rejects.toThrow(/not allowed/);
    void otherCab;
  });
});
