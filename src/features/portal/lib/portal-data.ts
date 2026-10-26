import type { Supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import type { PortalCabinet } from "./types";

type T<N extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][N]["Row"];

export type PortalPatient = Pick<T<"patients">, "id" | "cabinet_id" | "first_name" | "last_name" | "file_number">;
export type PortalAppointment = Pick<
  T<"appointments">,
  "id" | "cabinet_id" | "patient_id" | "dentist_id" | "type_id" | "starts_at" | "ends_at" | "status" | "source" | "title"
>;
export type PortalLine = Pick<T<"invoice_items">, "id" | "label" | "tooth" | "quantity" | "unit_price_gnf" | "sort_order" | "deleted_at">;
export type PortalPayment = Pick<T<"payments">, "id" | "amount_gnf" | "method" | "status" | "paid_at" | "deleted_at">;
export type PortalInvoice = Pick<
  T<"invoices">,
  "id" | "cabinet_id" | "patient_id" | "number" | "status" | "issue_date" | "due_date" | "total_gnf" | "paid_gnf"
> & { invoice_items: PortalLine[]; payments: PortalPayment[] };
export type PortalQuote = Pick<
  T<"quotes">,
  "id" | "cabinet_id" | "patient_id" | "number" | "status" | "issue_date" | "valid_until" | "total_gnf" | "notes"
> & { quote_items: PortalLine[] };
export type PrescriptionItem = { drug?: string; dosage?: string; duration?: string; instructions?: string };
export type PortalPrescription = Pick<T<"prescriptions">, "id" | "cabinet_id" | "patient_id" | "dentist_id" | "notes" | "issued_at"> & {
  items: PrescriptionItem[];
};
export type PortalDocument = Pick<
  T<"documents">,
  "id" | "cabinet_id" | "patient_id" | "kind" | "title" | "storage_path" | "mime_type" | "size_bytes" | "created_at"
>;

export type PortalData = {
  cabinets: PortalCabinet[];
  patients: PortalPatient[];
  appointments: PortalAppointment[];
  invoices: PortalInvoice[];
  quotes: PortalQuote[];
  prescriptions: PortalPrescription[];
  documents: PortalDocument[];
};

const LINE = "id, label, tooth, quantity, unit_price_gnf, sort_order, deleted_at";

/** Lignes actives triées. */
export function activeLines(lines: PortalLine[]): PortalLine[] {
  return lines.filter((l) => !l.deleted_at).sort((a, b) => a.sort_order - b.sort_order);
}

export function balance(inv: Pick<PortalInvoice, "total_gnf" | "paid_gnf" | "status">): number {
  if (inv.status === "cancelled") return 0;
  return Math.max(0, Number(inv.total_gnf) - Number(inv.paid_gnf));
}

export function normalizeItems(items: unknown): PrescriptionItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => ({
      // Ordonnances récentes : dosage (strength) et forme dans des champs séparés.
      drug:
        typeof x.drug === "string"
          ? [[x.drug, x.strength].filter((s) => typeof s === "string" && s.trim()).join(" "), typeof x.form === "string" && x.form.trim() ? x.form : ""]
              .filter(Boolean)
              .join(" — ")
          : undefined,
      dosage: typeof x.dosage === "string" ? x.dosage : undefined,
      duration: typeof x.duration === "string" ? x.duration : undefined,
      instructions: typeof x.instructions === "string" ? x.instructions : undefined,
    }));
}

/**
 * Charge tout l'espace patient. Les lectures passent par RLS (politiques *_portal_read) et sont
 * en plus filtrées sur les fiches du patient : un praticien qui est aussi patient ne doit voir
 * ici que ses propres données, pas celles de son cabinet.
 */
export async function loadPortalData(sb: Supabase, userId: string): Promise<PortalData> {
  // Rattache les fiches créées depuis la dernière connexion (sans effet si rien de nouveau).
  await sb.rpc("link_portal_patients").then(
    () => undefined,
    () => undefined,
  );
  const [cabRes, patRes] = await Promise.all([
    sb.rpc("portal_cabinets"),
    sb.from("patients").select("id, cabinet_id, first_name, last_name, file_number").eq("portal_user_id", userId).is("deleted_at", null),
  ]);
  if (cabRes.error) throw cabRes.error;
  if (patRes.error) throw patRes.error;
  const cabinets = (Array.isArray(cabRes.data) ? cabRes.data : []) as unknown as PortalCabinet[];
  const patients = patRes.data ?? [];
  const ids = patients.map((p) => p.id);
  if (ids.length === 0) return { cabinets, patients, appointments: [], invoices: [], quotes: [], prescriptions: [], documents: [] };

  const [appts, invoices, quotes, prescriptions, documents] = await Promise.all([
    sb
      .from("appointments")
      .select("id, cabinet_id, patient_id, dentist_id, type_id, starts_at, ends_at, status, source, title")
      .in("patient_id", ids)
      .is("deleted_at", null)
      .order("starts_at", { ascending: false })
      .limit(200),
    sb
      .from("invoices")
      .select(
        `id, cabinet_id, patient_id, number, status, issue_date, due_date, total_gnf, paid_gnf,
         invoice_items(${LINE}), payments(id, amount_gnf, method, status, paid_at, deleted_at)`,
      )
      .in("patient_id", ids)
      .neq("status", "draft")
      .is("deleted_at", null)
      .order("issue_date", { ascending: false }),
    sb
      .from("quotes")
      .select(`id, cabinet_id, patient_id, number, status, issue_date, valid_until, total_gnf, notes, quote_items(${LINE})`)
      .in("patient_id", ids)
      .neq("status", "draft")
      .is("deleted_at", null)
      .order("issue_date", { ascending: false }),
    sb
      .from("prescriptions")
      .select("id, cabinet_id, patient_id, dentist_id, notes, issued_at, items")
      .in("patient_id", ids)
      .eq("shared_with_patient", true)
      .is("deleted_at", null)
      .order("issued_at", { ascending: false }),
    sb
      .from("documents")
      .select("id, cabinet_id, patient_id, kind, title, storage_path, mime_type, size_bytes, created_at")
      .in("patient_id", ids)
      .eq("shared_with_patient", true)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);
  for (const r of [appts, invoices, quotes, prescriptions, documents]) if (r.error) throw r.error;

  return {
    cabinets,
    patients,
    appointments: appts.data ?? [],
    invoices: (invoices.data ?? []) as unknown as PortalInvoice[],
    quotes: (quotes.data ?? []) as unknown as PortalQuote[],
    prescriptions: (prescriptions.data ?? []).map((p) => ({ ...p, items: normalizeItems(p.items) })),
    documents: documents.data ?? [],
  };
}
