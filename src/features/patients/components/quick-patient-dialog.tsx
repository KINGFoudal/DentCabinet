"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle } from "lucide-react";
import { localDb, type Row } from "@/lib/local/db";
import { mutate } from "@/lib/sync/mutate";
import { formatPhone, fullName, normalizeGuineaPhone } from "@/lib/format";
import { useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { findPhoneDuplicates, type PatientForm } from "../lib/validation";
import { rememberPatient } from "../lib/recent";

/**
 * Création rapide d'un patient : prénom, nom, téléphone. Le reste de la fiche se complète
 * plus tard ; `onFull` ouvre le formulaire complet avec ce qui a déjà été saisi.
 */
export function QuickPatientDialog({
  open,
  onClose,
  initial,
  onSaved,
  onFull,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Partial<PatientForm>;
  onSaved: (p: Row<"patients">) => void;
  onFull: (values: Partial<PatientForm>) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t("patients.quick.title")}>
      {open && <QuickForm initial={initial} onClose={onClose} onSaved={onSaved} onFull={onFull} />}
    </Dialog>
  );
}

function QuickForm({
  initial,
  onClose,
  onSaved,
  onFull,
}: {
  initial?: Partial<PatientForm>;
  onClose: () => void;
  onSaved: (p: Row<"patients">) => void;
  onFull: (values: Partial<PatientForm>) => void;
}) {
  const t = useT();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { user } = useAuth();
  const [first, setFirst] = useState(initial?.first_name ?? "");
  const [last, setLast] = useState(initial?.last_name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [errors, setErrors] = useState<{ first?: string; last?: string; phone?: string }>({});
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);

  const patients = useLiveQuery(
    () => localDb().patients.where("cabinet_id").equals(cabinetId).filter((p) => !p.deleted_at).toArray(),
    [cabinetId],
  );
  const duplicates = useMemo(() => findPhoneDuplicates(patients ?? [], phone), [patients, phone]);

  async function save() {
    if (saving) return;
    const normalized = phone.trim() ? normalizeGuineaPhone(phone) : null;
    const e: typeof errors = {};
    if (!first.trim()) e.first = t("common.required");
    if (!last.trim()) e.last = t("common.required");
    if (phone.trim() && !normalized) e.phone = t("patients.form.invalidPhone");
    setErrors(e);
    if (Object.keys(e).length) return;
    if (duplicates.length && !confirmDuplicate) {
      setConfirmDuplicate(true);
      return;
    }
    setSaving(true);
    try {
      const p = await mutate("patients", {
        cabinet_id: cabinetId,
        first_name: first.trim(),
        last_name: last.trim(),
        phone: normalized,
        created_by: user?.id ?? null,
      });
      rememberPatient(cabinetId, p.id);
      toast(t("patients.form.created"));
      onClose();
      onSaved(p);
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("patients.fields.firstName")} required error={errors.first}>
          {(p) => <Input {...p} value={first} onChange={(e) => setFirst(e.target.value)} autoFocus autoComplete="off" />}
        </Field>
        <Field label={t("patients.fields.lastName")} required error={errors.last}>
          {(p) => <Input {...p} value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" />}
        </Field>
      </div>
      <Field label={t("patients.fields.phone")} error={errors.phone} hint={t("patients.form.phoneHint")}>
        {(p) => (
          <Input
            {...p}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="620 00 00 00"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setConfirmDuplicate(false);
            }}
          />
        )}
      </Field>
      {duplicates.length > 0 && (
        <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft p-2 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-warning">
            <AlertTriangle className="size-4 shrink-0" />
            {t("patients.form.duplicateText")}
          </p>
          <ul className="mt-1">
            {duplicates.slice(0, 3).map((d) => (
              <li key={d.id}>
                <Link href={`/app/patients/fiche?id=${d.id}`} className="font-medium text-primary underline" onClick={onClose}>
                  {fullName(d)}
                </Link>{" "}
                <span className="text-muted">{[d.file_number ?? t("patients.provisional"), formatPhone(d.phone)].join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <button
          type="button"
          className="text-sm text-primary hover:underline"
          onClick={() => onFull({ first_name: first, last_name: last, phone })}
        >
          {t("patients.quick.full")}
        </button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={saving} variant={confirmDuplicate ? "accent" : "primary"}>
            {confirmDuplicate ? t("patients.form.createAnyway") : t("patients.quick.createAndOpen")}
          </Button>
        </div>
      </div>
    </form>
  );
}
