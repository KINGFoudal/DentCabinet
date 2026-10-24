"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { parseGNF } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { saveLines, type EditableLine } from "../actions";
import { useActs, type InvoiceItem, type QuoteItem } from "../data";
import { useBilling } from "./common";

type Draft = { key: string; id?: string; act_id: string | null; plan_item_id?: string | null; label: string; tooth: string; quantity: string; price: string };

let seq = 0;
const key = () => `l${++seq}`;

function toDraft(i: InvoiceItem | QuoteItem): Draft {
  return {
    key: key(),
    id: i.id,
    act_id: i.act_id,
    plan_item_id: "plan_item_id" in i ? i.plan_item_id : null,
    label: i.label,
    tooth: i.tooth == null ? "" : String(i.tooth),
    quantity: String(i.quantity),
    price: String(i.unit_price_gnf),
  };
}

/** Valide une ligne saisie ; null si invalide. */
function parseDraft(d: Draft): EditableLine | null {
  const quantity = Number(d.quantity);
  const price = parseGNF(d.price);
  const tooth = d.tooth.trim() === "" ? null : Number(d.tooth);
  if (!d.label.trim() || !Number.isInteger(quantity) || quantity < 1 || price == null) return null;
  if (tooth != null && (!Number.isInteger(tooth) || tooth < 11 || tooth > 85)) return null;
  return { id: d.id, act_id: d.act_id, plan_item_id: d.plan_item_id, label: d.label.trim(), tooth, quantity, unit_price_gnf: price };
}

/** Fenêtre d'édition des lignes d'un devis ou d'une facture brouillon. */
export function LinesEditorDialog({
  open,
  onClose,
  kind,
  parentId,
  items,
}: {
  open: boolean;
  onClose: () => void;
  kind: "invoice" | "quote";
  parentId: string;
  items: readonly (InvoiceItem | QuoteItem)[];
}) {
  const { t } = useBilling();
  return (
    <Dialog open={open} onClose={onClose} title={t("billing.lines.title")} size="xl">
      {open && <Editor kind={kind} parentId={parentId} items={items} onDone={onClose} />}
    </Dialog>
  );
}

function Editor({
  kind,
  parentId,
  items,
  onDone,
}: {
  kind: "invoice" | "quote";
  parentId: string;
  items: readonly (InvoiceItem | QuoteItem)[];
  onDone: () => void;
}) {
  const { t, gnf, cabinetId } = useBilling();
  const toast = useToast();
  const acts = useActs(cabinetId);
  const activeActs = useMemo(() => (acts ?? []).filter((a) => a.active), [acts]);
  const categories = useMemo(() => [...new Set(activeActs.map((a) => a.category || ""))], [activeActs]);
  const [rows, setRows] = useState<Draft[]>(() => {
    const live = items.filter((i) => !i.deleted_at).map(toDraft);
    return live.length ? live : [{ key: key(), act_id: null, label: "", tooth: "", quantity: "1", price: "" }];
  });
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsed = rows.map(parseDraft);
  const total = parsed.reduce((s, l) => s + (l ? l.quantity * l.unit_price_gnf : 0), 0);

  const update = (k: string, patch: Partial<Draft>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const move = (idx: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = idx + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = rs.slice();
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });

  function pickAct(k: string, actId: string) {
    const act = activeActs.find((a) => a.id === actId);
    if (!act) return update(k, { act_id: null });
    update(k, { act_id: act.id, label: act.label, price: String(act.price_gnf) });
  }

  async function save() {
    // Les lignes entièrement vides sont ignorées.
    const meaningful = rows.filter((r, i) => parsed[i] || r.label.trim() || r.price.trim());
    const lines = meaningful.map(parseDraft);
    if (lines.some((l) => !l)) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      await saveLines(kind, cabinetId, parentId, items, lines as EditableLine[]);
      toast(t("common.saved"));
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {rows.map((r, idx) => {
          const invalid = showErrors && !parsed[idx] && (r.label.trim() || r.price.trim());
          return (
            <li key={r.key} className={`rounded-lg border p-3 ${invalid ? "border-danger" : "border-border"}`}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                <label className="col-span-2 flex flex-col gap-1 text-xs text-muted sm:col-span-4">
                  {t("billing.fields.act")}
                  <Select value={r.act_id ?? ""} onChange={(e) => pickAct(r.key, e.target.value)}>
                    <option value="">{t("billing.lines.freeEntry")}</option>
                    {categories.map((c) => (
                      <optgroup key={c} label={c || t("billing.acts.noCategory")}>
                        {activeActs
                          .filter((a) => (a.category || "") === c)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code ? `${a.code} – ` : ""}
                              {a.label}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </Select>
                </label>
                <label className="col-span-2 flex flex-col gap-1 text-xs text-muted sm:col-span-8">
                  {t("billing.fields.label")}
                  <Input value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} aria-invalid={invalid && !r.label.trim() ? true : undefined} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
                  {t("billing.fields.tooth")}
                  <Input inputMode="numeric" value={r.tooth} placeholder="16" onChange={(e) => update(r.key, { tooth: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
                  {t("billing.fields.quantity")}
                  <Input inputMode="numeric" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
                </label>
                <label className="col-span-2 flex flex-col gap-1 text-xs text-muted sm:col-span-4">
                  {t("billing.fields.unitPrice")}
                  <Input inputMode="numeric" value={r.price} placeholder="150 000" onChange={(e) => update(r.key, { price: e.target.value })} />
                </label>
                <div className="col-span-2 flex items-end justify-between gap-2 sm:col-span-4">
                  <span className="pb-2 text-sm font-medium">{parsed[idx] ? gnf(parsed[idx]!.quantity * parsed[idx]!.unit_price_gnf) : "—"}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => move(idx, -1)} aria-label={t("billing.lines.moveUp")} disabled={idx === 0}>
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => move(idx, 1)} aria-label={t("billing.lines.moveDown")} disabled={idx === rows.length - 1}>
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={t("common.delete")}>
                      <Trash2 className="size-4 text-danger" />
                    </Button>
                  </div>
                </div>
              </div>
              {invalid && <p className="mt-2 text-xs text-danger">{t("billing.lines.invalid")}</p>}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, { key: key(), act_id: null, label: "", tooth: "", quantity: "1", price: "" }])}>
          <Plus className="size-4" />
          {t("billing.lines.add")}
        </Button>
        <div className="text-base font-semibold">
          {t("billing.fields.total")} : {gnf(total)}
        </div>
      </div>
      {activeActs.length === 0 && <p className="text-xs text-muted">{t("billing.lines.noCatalog")}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button onClick={save} loading={saving}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
