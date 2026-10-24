"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle } from "lucide-react";
import { localDb, type Row } from "@/lib/local/db";
import { mutate } from "@/lib/sync/mutate";
import { formatPhone, fullName } from "@/lib/format";
import { useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  emptyPatientForm,
  findPhoneDuplicates,
  formFromPatient,
  validatePatientForm,
  type PatientForm,
  type PatientFormErrors,
} from "../lib/validation";

/** Création ou modification de la fiche administrative d'un patient. */
export function PatientFormDialog({
  open,
  onClose,
  patient,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Patient à modifier ; absent pour une création. */
  patient?: Row<"patients"> | null;
  /** Valeurs initiales pour une création (ex. nom saisi dans la recherche). */
  initial?: Partial<PatientForm>;
  onSaved?: (p: Row<"patients">) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t(patient ? "patients.form.editTitle" : "patients.form.newTitle")} size="lg">
      {open && <PatientFormBody key={patient?.id ?? "new"} patient={patient} initial={initial} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function PatientFormBody({
  patient,
  initial,
  onClose,
  onSaved,
}: {
  patient?: Row<"patients"> | null;
  initial?: Partial<PatientForm>;
  onClose: () => void;
  onSaved?: (p: Row<"patients">) => void;
}) {
  const t = useT();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { user } = useAuth();
  const [form, setForm] = useState<PatientForm>(() => (patient ? formFromPatient(patient) : { ...emptyPatientForm, ...initial }));
  const [errors, setErrors] = useState<PatientFormErrors>({});
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);

  const patients = useLiveQuery(
    () => localDb().patients.where("cabinet_id").equals(cabinetId).filter((p) => !p.deleted_at).toArray(),
    [cabinetId],
  );
  const duplicates = useMemo(() => findPhoneDuplicates(patients ?? [], form.phone, patient?.id), [patients, form.phone, patient?.id]);

  const set = <K extends keyof PatientForm>(k: K, v: PatientForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === "phone") setConfirmDuplicate(false);
  };
  const err = (k: keyof PatientForm) => (errors[k] ? t(errors[k]!) : undefined);

  async function save() {
    const res = validatePatientForm(form);
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    setErrors({});
    // Doublon par téléphone : confirmation explicite à la création.
    if (!patient && duplicates.length && !confirmDuplicate) {
      setConfirmDuplicate(true);
      return;
    }
    setSaving(true);
    try {
      const row = await mutate("patients", {
        ...(patient ? { id: patient.id } : { cabinet_id: cabinetId, created_by: user?.id ?? null }),
        ...res.patch,
      });
      toast(t(patient ? "patients.form.updated" : "patients.form.created"));
      onSaved?.(row);
      onClose();
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  const text = (k: keyof PatientForm, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label} error={err(k)} required={k === "first_name" || k === "last_name"}>
      {(p) => <Input {...p} {...props} value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} />}
    </Field>
  );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-primary">{t("patients.form.identity")}</legend>
        {text("first_name", t("patients.fields.firstName"), { autoFocus: !patient, autoComplete: "off" })}
        {text("last_name", t("patients.fields.lastName"), { autoComplete: "off" })}
        <Field label={t("patients.fields.sex")}>
          {(p) => (
            <Select {...p} value={form.sex} onChange={(e) => set("sex", e.target.value as PatientForm["sex"])}>
              <option value="">{t("patients.sex.unknown")}</option>
              <option value="female">{t("patients.sex.female")}</option>
              <option value="male">{t("patients.sex.male")}</option>
              <option value="other">{t("patients.sex.other")}</option>
            </Select>
          )}
        </Field>
        {text("birth_date", t("patients.fields.birthDate"), { type: "date", max: new Date().toISOString().slice(0, 10) })}
        {text("profession", t("patients.fields.profession"))}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-primary">{t("patients.form.contact")}</legend>
        <Field label={t("patients.fields.phone")} error={err("phone")} hint={t("patients.form.phoneHint")}>
          {(p) => (
            <Input
              {...p}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="620 00 00 00"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          )}
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox
            label={t("patients.fields.whatsappOptIn")}
            checked={form.whatsapp_opt_in}
            onChange={(e) => set("whatsapp_opt_in", e.target.checked)}
          />
        </div>
        {duplicates.length > 0 && (
          <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm sm:col-span-2">
            <p className="flex items-center gap-2 font-medium text-warning">
              <AlertTriangle className="size-4 shrink-0" />
              {t("patients.form.duplicateText")}
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {duplicates.slice(0, 3).map((d) => (
                <li key={d.id}>
                  <Link href={`/app/patients/fiche?id=${d.id}`} className="font-medium text-primary underline" onClick={onClose}>
                    {fullName(d)}
                  </Link>{" "}
                  <span className="text-muted">
                    {[d.file_number ?? t("patients.provisional"), formatPhone(d.phone)].join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {text("email", t("patients.fields.email"), { type: "email", inputMode: "email", autoComplete: "off" })}
        {text("city", t("patients.fields.city"))}
        <div className="sm:col-span-2">{text("address", t("patients.fields.address"))}</div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-primary">{t("patients.form.emergency")}</legend>
        {text("emergency_contact_name", t("patients.fields.emergencyName"))}
        {text("emergency_contact_phone", t("patients.fields.emergencyPhone"), { type: "tel", inputMode: "tel", placeholder: "620 00 00 00" })}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-primary">{t("patients.form.insurance")}</legend>
        {text("insurance_name", t("patients.fields.insuranceName"))}
        {text("insurance_number", t("patients.fields.insuranceNumber"))}
      </fieldset>

      <Field label={t("patients.fields.adminNotes")}>
        {(p) => <Textarea {...p} rows={2} value={form.admin_notes} onChange={(e) => set("admin_notes", e.target.value)} />}
      </Field>

      <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap justify-end gap-2 border-t border-border bg-surface px-4 py-3">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={saving} variant={confirmDuplicate ? "accent" : "primary"}>
          {confirmDuplicate ? t("patients.form.createAnyway") : patient ? t("common.save") : t("common.create")}
        </Button>
      </div>
    </form>
  );
}
