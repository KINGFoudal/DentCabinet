"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Search } from "lucide-react";
import { localDb, type Row } from "@/lib/local/db";
import { mutate } from "@/lib/sync/mutate";
import { formatPhone, fullName, normalizeGuineaPhone } from "@/lib/format";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

/** Normalise pour la recherche : minuscules, sans accents. */
export function searchKey(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function matchesPatient(p: Row<"patients">, query: string) {
  const q = searchKey(query.trim());
  if (!q) return true;
  const digits = query.replace(/\D/g, "");
  const hay = searchKey(`${p.first_name} ${p.last_name} ${p.last_name} ${p.first_name} ${p.file_number ?? ""}`);
  return hay.includes(q) || (digits.length >= 3 && (p.phone ?? "").includes(digits));
}

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
  const [error, setError] = useState<string | null>(null);

  const patients = useLiveQuery(
    () => localDb().patients.where("cabinet_id").equals(cabinetId).filter((p) => !p.deleted_at).toArray(),
    [cabinetId],
  );
  const selected = useMemo(() => patients?.find((p) => p.id === value) ?? null, [patients, value]);
  const results = useMemo(
    () =>
      (patients ?? [])
        .filter((p) => matchesPatient(p, query))
        .sort((a, b) => a.last_name.localeCompare(b.last_name))
        .slice(0, 8),
    [patients, query],
  );

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-primary-soft px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{fullName(selected)}</div>
          <div className="text-xs text-muted">
            {[selected.file_number, formatPhone(selected.phone)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          {t("common.edit")}
        </Button>
      </div>
    );
  }

  async function create() {
    const normalized = phone ? normalizeGuineaPhone(phone) : null;
    if (phone && !normalized) return setError("Téléphone invalide");
    if (!first.trim() || !last.trim()) return setError(t("common.required"));
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
          <Field label="Prénom" required>
            {(p) => <Input {...p} value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />}
          </Field>
          <Field label="Nom" required>
            {(p) => <Input {...p} value={last} onChange={(e) => setLast(e.target.value)} />}
          </Field>
        </div>
        <Field label="Téléphone" error={error}>
          {(p) => <Input {...p} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="620 00 00 00" />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={create}>
            {t("common.create")}
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
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder={t("common.search")}
          aria-label={t("common.search")}
        />
      </div>
      <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {results.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onChange(p)} className="w-full px-3 py-2 text-left hover:bg-primary-soft">
              <div className="text-sm font-medium">{fullName(p)}</div>
              <div className="text-xs text-muted">{[p.file_number, formatPhone(p.phone)].filter(Boolean).join(" · ")}</div>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">—</li>}
      </ul>
      {allowCreate && can.patientsWrite && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const [f, ...rest] = query.trim().split(/\s+/);
            setFirst(f ?? "");
            setLast(rest.join(" "));
            setCreating(true);
          }}
        >
          <Plus className="size-4" />
          {t("common.add")}
        </Button>
      )}
    </div>
  );
}
