import { normalizeGuineaPhone } from "@/lib/format";
import type { Enums } from "@/lib/database.types";

/** Valeurs du formulaire de fiche administrative (chaînes brutes saisies). */
export type PatientForm = {
  first_name: string;
  last_name: string;
  sex: "" | Enums<"sex">;
  birth_date: string;
  phone: string;
  whatsapp_opt_in: boolean;
  email: string;
  address: string;
  city: string;
  profession: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  insurance_name: string;
  insurance_number: string;
  admin_notes: string;
};

export const emptyPatientForm: PatientForm = {
  first_name: "",
  last_name: "",
  sex: "",
  birth_date: "",
  phone: "",
  whatsapp_opt_in: true,
  email: "",
  address: "",
  city: "",
  profession: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  insurance_name: "",
  insurance_number: "",
  admin_notes: "",
};

type PatientLike = { [K in keyof PatientForm]?: PatientForm[K] | null } & { sex?: Enums<"sex"> | null };

/** Pré-remplit le formulaire à partir d'une ligne patient. */
export function formFromPatient(p: PatientLike): PatientForm {
  const out = { ...emptyPatientForm };
  for (const k of Object.keys(emptyPatientForm) as (keyof PatientForm)[]) {
    const v = p[k];
    if (v != null) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Clés de traduction des erreurs, par champ. */
export type PatientFormErrors = Partial<Record<keyof PatientForm, string>>;

export type PatientPatch = {
  first_name: string;
  last_name: string;
  sex: Enums<"sex"> | null;
  birth_date: string | null;
  phone: string | null;
  whatsapp_opt_in: boolean;
  email: string | null;
  address: string | null;
  city: string | null;
  profession: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  insurance_name: string | null;
  insurance_number: string | null;
  admin_notes: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidISODate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Valide et normalise le formulaire. Les téléphones sont convertis en +224…,
 * les champs vides deviennent null.
 */
export function validatePatientForm(
  form: PatientForm,
  today = new Date().toISOString().slice(0, 10),
): { ok: true; patch: PatientPatch } | { ok: false; errors: PatientFormErrors } {
  const errors: PatientFormErrors = {};
  const s = (v: string) => (v.trim() ? v.trim() : null);

  if (!form.first_name.trim()) errors.first_name = "common.required";
  if (!form.last_name.trim()) errors.last_name = "common.required";

  const phone = form.phone.trim() ? normalizeGuineaPhone(form.phone) : null;
  if (form.phone.trim() && !phone) errors.phone = "patients.form.invalidPhone";

  const emergencyPhone = form.emergency_contact_phone.trim() ? normalizeGuineaPhone(form.emergency_contact_phone) : null;
  if (form.emergency_contact_phone.trim() && !emergencyPhone) errors.emergency_contact_phone = "patients.form.invalidPhone";

  const email = s(form.email);
  if (email && !EMAIL_RE.test(email)) errors.email = "patients.form.invalidEmail";

  const birth = s(form.birth_date);
  if (birth && (!isValidISODate(birth) || birth > today || birth < "1900-01-01")) errors.birth_date = "patients.form.invalidBirthDate";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    patch: {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      sex: form.sex || null,
      birth_date: birth,
      phone,
      whatsapp_opt_in: form.whatsapp_opt_in,
      email: email?.toLowerCase() ?? null,
      address: s(form.address),
      city: s(form.city),
      profession: s(form.profession),
      emergency_contact_name: s(form.emergency_contact_name),
      emergency_contact_phone: emergencyPhone,
      insurance_name: s(form.insurance_name),
      insurance_number: s(form.insurance_number),
      admin_notes: s(form.admin_notes),
    },
  };
}

/** Patients actifs ayant le même téléphone (après normalisation), hors `excludeId`. */
export function findPhoneDuplicates<T extends { id: string; phone: string | null; deleted_at?: string | null }>(
  patients: readonly T[],
  phoneInput: string,
  excludeId?: string | null,
): T[] {
  const phone = phoneInput.trim() ? normalizeGuineaPhone(phoneInput) : null;
  if (!phone) return [];
  return patients.filter((p) => !p.deleted_at && p.id !== excludeId && p.phone === phone);
}
