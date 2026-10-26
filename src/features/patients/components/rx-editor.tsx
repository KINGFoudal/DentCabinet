"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { BookmarkPlus, Check, History, Plus, Search, X } from "lucide-react";
import { mutate } from "@/lib/sync/mutate";
import { useAuth } from "@/lib/auth/auth-provider";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { duplicateRxItems, emptyRxItem, latestPrescription, type RxItem } from "../lib/clinical";
import {
  alreadyInList,
  baseTemplates,
  checkedRefs,
  customTemplates,
  groupTemplates,
  medicationFromRxItem,
  searchTemplates,
  toggleTemplate,
} from "../lib/medications";
import { useMedications, usePatientPrescriptions } from "../lib/hooks";

/** Droit de modifier la liste de médicaments du cabinet (miroir de la RLS : admin, dentiste). */
export function useCanEditMedications() {
  const { roles, readOnly } = useCabinet();
  return !readOnly && roles.some((r) => r === "admin" || r === "dentist");
}

/**
 * Saisie des lignes d'une ordonnance : liste de médicaments à cocher (cabinet + base) avec
 * recherche, et lignes modifiables. Composant contrôlé (items / onChange).
 * Clavier : la recherche a le focus ; Entrée coche le premier résultat ou ajoute une ligne libre.
 */
export function RxEditor({
  patientId,
  items,
  onChange,
  allowReuse = true,
  autoFocus = true,
}: {
  patientId: string;
  items: RxItem[];
  onChange: (items: RxItem[]) => void;
  allowReuse?: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { user } = useAuth();
  const canEditMeds = useCanEditMedications();
  const custom = useMedications(cabinetId);
  const previous = usePatientPrescriptions(cabinetId, allowReuse ? patientId : null);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  const templates = useMemo(() => [...customTemplates(custom ?? []), ...baseTemplates(t)], [custom, t]);
  const results = useMemo(() => searchTemplates(templates, query), [templates, query]);
  const groups = useMemo(() => groupTemplates(results), [results]);
  const checked = checkedRefs(items);
  const last = previous ? latestPrescription(previous) : null;
  const filled = items.filter((i) => i.drug.trim()).length;

  const update = (i: number, patch: Partial<RxItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  function focusLine(index: number) {
    // Après le rendu : place le curseur sur la posologie de la ligne ajoutée.
    requestAnimationFrame(() => {
      listRef.current?.querySelectorAll<HTMLInputElement>("[data-rx-focus]")[index]?.focus();
    });
  }

  function addFree(name: string) {
    const blank = items.findIndex((i) => !i.drug.trim() && !i.ref);
    const line = { ...emptyRxItem, drug: name };
    if (blank >= 0) {
      onChange(items.map((it, j) => (j === blank ? line : it)));
      focusLine(blank);
    } else {
      onChange([...items, line]);
      focusLine(items.length);
    }
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (results.length) onChange(toggleTemplate(items, results[0]));
    else addFree(q);
    setQuery("");
  }

  async function saveToList(item: RxItem) {
    const fields = medicationFromRxItem(item);
    if (!fields.name) return;
    await mutate("medications", { cabinet_id: cabinetId, ...fields, created_by: user?.id ?? null, deleted_at: null });
    toast(t("patients.rx.savedToList"));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <section className="flex min-w-0 flex-col gap-2" aria-label={t("patients.rx.listTitle")}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            type="search"
            className="pl-9"
            value={query}
            autoFocus={autoFocus}
            placeholder={t("patients.rx.searchPlaceholder")}
            aria-label={t("patients.rx.searchPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
        </div>
        <p className="hidden text-xs text-muted sm:block">{t("patients.rx.keyboardHint")}</p>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-border lg:max-h-[26rem]">
          {groups.length === 0 ? (
            <div className="flex flex-col items-start gap-2 p-3 text-sm text-muted">
              <p>{t("patients.rx.noMatch", { query: query.trim() })}</p>
              {query.trim() && (
                <Button size="sm" variant="secondary" onClick={() => (addFree(query.trim()), setQuery(""))}>
                  <Plus className="size-4" />
                  {t("patients.rx.addFree", { query: query.trim() })}
                </Button>
              )}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.group}>
                <div className="sticky top-0 z-10 border-b border-border bg-background px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  {t(`patients.meds.groups.${g.group}`)}
                </div>
                <ul>
                  {g.items.map((m) => {
                    const on = checked.has(m.ref);
                    return (
                      <li key={m.ref}>
                        <label className={cn("flex cursor-pointer items-start gap-2 px-3 py-2 text-sm hover:bg-primary-soft", on && "bg-primary-soft")}>
                          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={on} onChange={() => onChange(toggleTemplate(items, m))} />
                          <span className="min-w-0">
                            <span className="font-medium">{m.name}</span>
                            {m.strength && <span className="text-muted"> {m.strength}</span>}
                            {m.form && <span className="block truncate text-xs text-muted">{m.form}</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
        <p className="text-xs italic text-muted">{t("patients.rx.indicative")}</p>
      </section>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("patients.rx.linesTitle", { count: filled })}</h3>
          {allowReuse && last && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange(duplicateRxItems(last.items));
                toast(t("patients.rx.duplicated"));
              }}
            >
              <History className="size-4" />
              {t("patients.rx.reuseLast")}
            </Button>
          )}
        </div>
        {filled === 0 && items.length <= 1 && <p className="rounded-lg bg-background p-3 text-sm text-muted">{t("patients.rx.emptyLines")}</p>}
        <ol ref={listRef} className="flex flex-col gap-3">
          {items.map((it, i) => {
            const isCustom = it.ref?.startsWith("custom:");
            const inList = isCustom || alreadyInList(templates, it);
            return (
              <li key={i} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-semibold text-primary">#{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{it.drug}</span>
                  {canEditMeds && it.drug.trim() && !it.ref?.startsWith("base:") && (
                    <Button size="sm" variant="ghost" disabled={inList} onClick={() => saveToList(it)} title={t(inList ? "patients.rx.inList" : "patients.rx.saveToList")}>
                      {inList ? <Check className="size-4" /> : <BookmarkPlus className="size-4" />}
                      <span className="hidden sm:inline">{t(inList ? "patients.rx.inList" : "patients.rx.saveToList")}</span>
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => onChange(items.length > 1 ? items.filter((_, j) => j !== i) : [{ ...emptyRxItem }])} aria-label={t("patients.rx.removeLine")}>
                    <X className="size-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                  <LineInput className="col-span-2 sm:col-span-6" mark="drug" label={t("patients.rx.drug")} value={it.drug} placeholder={t("patients.rx.drugPlaceholder")} onChange={(v) => update(i, { drug: v })} />
                  <LineInput className="sm:col-span-3" label={t("patients.rx.strength")} value={it.strength ?? ""} placeholder={t("patients.rx.strengthPlaceholder")} onChange={(v) => update(i, { strength: v })} />
                  <LineInput className="sm:col-span-3" label={t("patients.rx.form")} value={it.form ?? ""} placeholder={t("patients.rx.formPlaceholder")} onChange={(v) => update(i, { form: v })} />
                  <LineInput className="col-span-2 sm:col-span-8" mark="posology" label={t("patients.rx.dosage")} value={it.dosage} placeholder={t("patients.rx.dosagePlaceholder")} onChange={(v) => update(i, { dosage: v })} />
                  <LineInput className="col-span-2 sm:col-span-4" label={t("patients.rx.duration")} value={it.duration} placeholder={t("patients.rx.durationPlaceholder")} onChange={(v) => update(i, { duration: v })} />
                  <LineInput className="col-span-2 sm:col-span-12" label={t("patients.rx.instructions")} value={it.instructions} onChange={(v) => update(i, { instructions: v })} />
                </div>
              </li>
            );
          })}
        </ol>
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onChange([...items, { ...emptyRxItem }]);
              requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLInputElement>("[data-rx-drug]")[items.length]?.focus());
            }}
          >
            <Plus className="size-4" />
            {t("patients.rx.addLine")}
          </Button>
        </div>
      </section>
    </div>
  );
}

function LineInput({
  label,
  value,
  onChange,
  placeholder,
  className,
  mark,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  mark?: "drug" | "posology";
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-xs text-muted", className)}>
      {label}
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        {...(mark === "posology" ? { "data-rx-focus": "" } : mark === "drug" ? { "data-rx-drug": "" } : {})}
      />
    </label>
  );
}
