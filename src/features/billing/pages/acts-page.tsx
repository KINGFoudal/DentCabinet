"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Pencil, Plus, Stethoscope, Trash2 } from "lucide-react";
import { parseGNF } from "@/lib/format";
import { mutate, softDelete } from "@/lib/sync/mutate";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, PageSpinner } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { RequirePermission } from "@/components/app/app-gate";
import { searchKey } from "@/features/patients/components/patient-picker";
import { useActs, type Act } from "../data";
import { actsToImport } from "../lib/catalog";
import { useBilling } from "../components/common";

/** Catalogue des actes et tarifs du cabinet (/app/parametres/actes, administrateur). */
export default function ActsPage() {
  const { can } = useBilling();
  return (
    <RequirePermission allowed={can.settings}>
      <ActsScreen />
    </RequirePermission>
  );
}

function ActsScreen() {
  const { t, gnf, can, cabinetId } = useBilling();
  const toast = useToast();
  const acts = useActs(cabinetId);
  const writable = can.settingsWrite;
  const [editing, setEditing] = useState<Act | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [toDelete, setToDelete] = useState<Act | null>(null);
  const [showInactive, setShowInactive] = useState(true);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = searchKey(query.trim());
    const list = (acts ?? []).filter(
      (a) => (showInactive || a.active) && (!q || searchKey(`${a.code ?? ""} ${a.label} ${a.category ?? ""}`).includes(q)),
    );
    const m = new Map<string, Act[]>();
    for (const a of list) {
      const k = a.category || "";
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.entries()];
  }, [acts, showInactive, query]);

  const missing = acts ? actsToImport(acts) : [];

  return (
    <>
      <Link href="/app/parametres" className={buttonClass("ghost", "sm", "no-print mb-2 self-start")}>
        <ArrowLeft className="size-4" />
        {t("nav.settings")}
      </Link>
      <PageHeader
        title={t("billing.acts.title")}
        subtitle={t("billing.acts.subtitle")}
        actions={
          writable && (
            <>
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <Download className="size-4" />
                {t("billing.acts.import")}
              </Button>
              <Button onClick={() => setEditing("new")}>
                <Plus className="size-4" />
                {t("billing.acts.add")}
              </Button>
            </>
          )
        }
      />
      {!writable && (
        <p className="mb-3">
          <Badge>{t("common.readOnly")}</Badge>
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("common.search")} aria-label={t("common.search")} />
        <Checkbox label={t("billing.acts.showInactive")} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
      </div>

      {!acts ? (
        <PageSpinner />
      ) : acts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Stethoscope />}
            title={t("billing.acts.empty")}
            description={t("billing.acts.emptyHint")}
            action={
              writable && (
                <Button onClick={() => setImporting(true)}>
                  <Download className="size-4" />
                  {t("billing.acts.import")}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(([category, list]) => (
            <Card key={category}>
              <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">{category || t("billing.acts.noCategory")}</h2>
              <ul className="divide-y divide-border">
                {list.map((a) => (
                  <li key={a.id} className={`flex items-center gap-3 px-4 py-2 ${a.active ? "" : "opacity-60"}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {a.code && <span className="mr-2 font-mono text-xs text-muted">{a.code}</span>}
                        {a.label}
                      </div>
                      <div className="text-xs text-muted">
                        {a.default_duration_minutes ? t("billing.acts.minutes", { n: a.default_duration_minutes }) : ""}
                        {!a.active && <Badge className="ml-2">{t("billing.acts.inactive")}</Badge>}
                      </div>
                    </div>
                    <div className="whitespace-nowrap text-sm font-semibold">{gnf(a.price_gnf)}</div>
                    {writable && (
                      <div className="flex">
                        <Button size="sm" variant="ghost" aria-label={t("common.edit")} onClick={() => setEditing(a)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => setToDelete(a)}>
                          <Trash2 className="size-4 text-danger" />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          {groups.length === 0 && <p className="text-center text-sm text-muted">—</p>}
        </div>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={t(editing === "new" ? "billing.acts.add" : "billing.acts.edit")}>
        {editing !== null && (
          <ActForm
            act={editing === "new" ? null : editing}
            categories={[...new Set((acts ?? []).map((a) => a.category).filter(Boolean) as string[])]}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>

      <Dialog
        open={importing}
        onClose={() => setImporting(false)}
        title={t("billing.acts.importTitle")}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setImporting(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={missing.length === 0}
              onClick={async () => {
                const list = missing;
                setImporting(false);
                for (const b of list) {
                  await mutate("acts", {
                    cabinet_id: cabinetId,
                    code: b.code,
                    label: b.label,
                    category: b.category,
                    price_gnf: b.price_gnf,
                    default_duration_minutes: b.duration,
                    active: true,
                    deleted_at: null,
                  });
                }
                toast(t("billing.acts.imported", { count: list.length }));
              }}
            >
              {t("billing.acts.importConfirm", { count: missing.length })}
            </Button>
          </>
        }
      >
        <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{t("billing.acts.importHint")}</p>
        {missing.length === 0 ? (
          <p className="text-sm text-muted">{t("billing.acts.nothingToImport")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {missing.map((b) => (
              <li key={b.code} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span>
                  <span className="mr-2 font-mono text-xs text-muted">{b.code}</span>
                  {b.label}
                  <span className="ml-1 text-xs text-muted">· {b.category}</span>
                </span>
                <span className="whitespace-nowrap">{gnf(b.price_gnf)}</span>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        danger
        title={t("billing.acts.deleteTitle")}
        message={t("billing.acts.deleteMessage", { label: toDelete?.label ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => toDelete && void softDelete("acts", toDelete.id)}
      />
    </>
  );
}

function ActForm({ act, categories, onDone }: { act: Act | null; categories: string[]; onDone: () => void }) {
  const { t, cabinetId } = useBilling();
  const toast = useToast();
  const [code, setCode] = useState(act?.code ?? "");
  const [label, setLabel] = useState(act?.label ?? "");
  const [category, setCategory] = useState(act?.category ?? "");
  const [price, setPrice] = useState(act ? String(act.price_gnf) : "");
  const [duration, setDuration] = useState(act?.default_duration_minutes ? String(act.default_duration_minutes) : "");
  const [active, setActive] = useState(act?.active ?? true);
  const [errors, setErrors] = useState<{ label?: string; price?: string; duration?: string }>({});

  async function save() {
    const p = parseGNF(price);
    const d = duration.trim() ? Number(duration) : null;
    const errs: typeof errors = {};
    if (!label.trim()) errs.label = t("common.required");
    if (p == null) errs.price = t("billing.acts.priceInvalid");
    if (d != null && (!Number.isInteger(d) || d < 5 || d > 480)) errs.duration = t("billing.acts.durationInvalid");
    setErrors(errs);
    if (Object.keys(errs).length) return;
    await mutate("acts", {
      ...(act ? { id: act.id } : {}),
      cabinet_id: cabinetId,
      code: code.trim().toUpperCase() || null,
      label: label.trim(),
      category: category.trim() || null,
      price_gnf: p!,
      default_duration_minutes: d,
      active,
      deleted_at: null,
    });
    toast(t("common.saved"));
    onDone();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("billing.fields.code")}>
          {(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value)} maxLength={16} />}
        </Field>
        <Field label={t("billing.fields.label")} required error={errors.label} className="col-span-2">
          {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />}
        </Field>
      </div>
      <Field label={t("billing.fields.category")}>
        {(p) => (
          <>
            <Input {...p} value={category} onChange={(e) => setCategory(e.target.value)} list="act-categories" />
            <datalist id="act-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("billing.fields.priceGnf")} required error={errors.price}>
          {(p) => <Input {...p} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="150 000" />}
        </Field>
        <Field label={t("billing.fields.duration")} error={errors.duration}>
          {(p) => <Input {...p} inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ""))} placeholder="30" />}
        </Field>
      </div>
      <Checkbox label={t("billing.acts.activeLabel")} checked={active} onChange={(e) => setActive(e.target.checked)} />
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button onClick={save}>{t("common.save")}</Button>
      </div>
    </div>
  );
}
