"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Plus, Search } from "lucide-react";
import { localDb, type Row } from "@/lib/local/db";
import { mutate } from "@/lib/sync/mutate";
import { formatPhone, fullName, normalizeGuineaPhone } from "@/lib/format";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { matchesPatient, searchKey, sortPatients } from "../lib/search";
import { findPhoneDuplicates } from "../lib/validation";

// API publique conservée pour l'agenda et la facturation.
export { matchesPatient, searchKey };

/**
 * Recherche d'un patient dans la base locale, avec création rapide (prénom, nom, téléphone).
 * Utilisé par l'agenda, la facturation et le dossier patient.
 */
export function PatientPicker({
  value,
  onChange,
  allowCreate = true,
  autoFocus,
}: {
  value: string | null;
  onChange: (patient: Row<"patients"> | null) => void;
  allowCreate?: boolean;
  autoFocus?: boolean;
}) {
  const t = useT();
  const cabinetId = useCabinetId();
  const { can } = useCabinet();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<{ first?: string; last?: string; phone?: string }>({});

  const patients = useLiveQuery(
    () => localDb().patients.where("cabinet_id").equals(cabinetId).filter((p) => !p.deleted_at).toArray(),
    [cabinetId],
  );
  const selected = useMemo(() => patients?.find((p) => p.id === value) ?? null, [patients, value]);
  const results = useMemo(
    () => sortPatients((patients ?? []).filter((p) => matchesPatient(p, query)), "name").slice(0, 8),
    [patients, query],
  );
  const duplicates = useMemo(() => findPhoneDuplicates(patients ?? [], phone), [patients, phone]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-primary-soft px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{fullName(selected)}</div>
          <div className="text-xs text-muted">
            {[selected.file_number ?? t("patients.provisional"), formatPhone(selected.phone)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          {t("patients.picker.change")}
        </Button>
      </div>
    );
  }

  async function create() {
    const normalized = phone.trim() ? normalizeGuineaPhone(phone) : null;
    const e: typeof errors = {};
    if (!first.trim()) e.first = t("common.required");
    if (!last.trim()) e.last = t("common.required");
    if (phone.trim() && !normalized) e.phone = t("patients.form.invalidPhone");
    setErrors(e);
    if (Object.keys(e).length) return;
    const p = await mutate("patients", {
      cabinet_id: cabinetId,
      first_name: first.trim(),
      last_name: last.trim(),
      phone: normalized,
      created_by: user?.id ?? null,
    });
    setCreating(false);
    onChange(p);
  }

  if (creating) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("patients.fields.firstName")} required error={errors.first}>
            {(p) => <Input {...p} value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />}
          </Field>
          <Field label={t("patients.fields.lastName")} required error={errors.last}>
            {(p) => <Input {...p} value={last} onChange={(e) => setLast(e.target.value)} />}
          </Field>
        </div>
        <Field label={t("patients.fields.phone")} error={errors.phone}>
          {(p) => <Input {...p} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="620 00 00 00" />}
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
                  <button type="button" className="text-left font-medium text-primary underline" onClick={() => onChange(d)}>
                    {fullName(d)}
                  </button>{" "}
                  <span className="text-muted">{d.file_number ?? t("patients.provisional")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={create}>
            {duplicates.length ? t("patients.form.createAnyway") : t("common.create")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input
          className="pl-9"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("patients.searchPlaceholder")}
          aria-label={t("common.search")}
        />
      </div>
      <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {results.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onChange(p)} className="w-full px-3 py-2 text-left hover:bg-primary-soft">
              <div className="text-sm font-medium">{fullName(p)}</div>
              <div className="text-xs text-muted">
                {[p.file_number ?? t("patients.provisional"), formatPhone(p.phone)].filter(Boolean).join(" · ")}
              </div>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">{t("patients.picker.noMatch")}</li>}
      </ul>
      {allowCreate && can.patientsWrite && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const q = query.trim();
            if (/^[\d\s+]+$/.test(q)) {
              setFirst("");
              setLast("");
              setPhone(q);
            } else {
              const [f, ...rest] = q.split(/\s+/);
              setFirst(f ?? "");
              setLast(rest.join(" "));
            }
            setCreating(true);
          }}
        >
          <Plus className="size-4" />
          {t("patients.picker.create")}
        </Button>
      )}
    </div>
  );
}
