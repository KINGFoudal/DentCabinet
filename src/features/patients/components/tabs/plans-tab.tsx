"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";
import { localDb, type Row } from "@/lib/local/db";
import { mutate, softDelete } from "@/lib/sync/mutate";
import { formatGNF, parseGNF } from "@/lib/format";
import type { Enums } from "@/lib/database.types";
import { useAuth } from "@/lib/auth/auth-provider";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, EmptyState } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { groupBySteps, lineTotal, planTotals } from "../../lib/clinical";
import { isValidTooth } from "../../lib/fdi";
import { staffName, useStaffNames } from "../../lib/hooks";
import { useReportWrite } from "@/lib/sync/report-write";

type Plan = Row<"treatment_plans">;
type Item = Row<"treatment_plan_items">;
type PlanStatus = Enums<"plan_status">;
type ItemStatus = Enums<"plan_item_status">;

const PLAN_STATUSES: PlanStatus[] = ["draft", "proposed", "accepted", "in_progress", "completed", "cancelled"];
const ITEM_STATUSES: ItemStatus[] = ["planned", "done", "cancelled"];
const PLAN_TONE: Record<PlanStatus, Tone> = {
  draft: "neutral",
  proposed: "info",
  accepted: "primary",
  in_progress: "warning",
  completed: "success",
  cancelled: "neutral",
};
const ITEM_TONE: Record<ItemStatus, Tone> = { planned: "info", done: "success", cancelled: "neutral" };

export function PlansTab({ patientId }: { patientId: string }) {
  const { t } = useI18n();
  const cabinetId = useCabinetId();
  const { can } = useCabinet();
  const [editing, setEditing] = useState<Plan | "new" | null>(null);

  const data = useLiveQuery(async () => {
    const db = localDb();
    const plans = (
      await db.treatment_plans
        .where("patient_id")
        .equals(patientId)
        .filter((p) => p.cabinet_id === cabinetId && !p.deleted_at)
        .toArray()
    ).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const items = plans.length
      ? await db.treatment_plan_items
          .where("plan_id")
          .anyOf(plans.map((p) => p.id))
          .filter((i) => !i.deleted_at)
          .toArray()
      : [];
    return { plans, items };
  }, [patientId, cabinetId]);

  return (
    <div className="flex flex-col gap-4">
      {can.clinicalWrite && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {t("patients.plans.new")}
          </Button>
        </div>
      )}
      {data && data.plans.length === 0 && (
        <Card>
          <EmptyState icon={<ClipboardList />} title={t("patients.plans.empty")} />
        </Card>
      )}
      {data?.plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} items={data.items.filter((i) => i.plan_id === plan.id)} onEdit={() => setEditing(plan)} />
      ))}
      <PlanDialog key={editing === "new" ? "new" : (editing?.id ?? "none")} patientId={patientId} plan={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function PlanCard({ plan, items, onEdit }: { plan: Plan; items: Item[]; onEdit: () => void }) {
  const report = useReportWrite();
  const { t, locale } = useI18n();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { can } = useCabinet();
  const names = useStaffNames(cabinetId);
  const [itemDialog, setItemDialog] = useState<Item | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const steps = useMemo(() => groupBySteps([...items].sort((a, b) => a.created_at.localeCompare(b.created_at))), [items]);
  const totals = planTotals(items);
  const nextStep = steps.length ? steps[steps.length - 1].step : 1;
  const write = can.clinicalWrite;

  async function setItemStatus(item: Item, status: ItemStatus) {
    await mutate("treatment_plan_items", { id: item.id, status, done_at: status === "done" ? new Date().toISOString() : null });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{plan.title}</h3>
          <p className="text-xs text-muted">{t("patients.plans.practitioner", { name: staffName(names, plan.dentist_id) })}</p>
          {plan.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{plan.notes}</p>}
        </div>
        <div className="flex items-center gap-2">
          {write ? (
            <Select
              aria-label={t("patients.plans.status")}
              value={plan.status}
              onChange={(e) => report(mutate("treatment_plans", { id: plan.id, status: e.target.value as PlanStatus }))}
              className="h-8 w-36"
            >
              {PLAN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`patients.plans.statusValues.${s}`)}
                </option>
              ))}
            </Select>
          ) : (
            <Badge tone={PLAN_TONE[plan.status]}>{t(`patients.plans.statusValues.${plan.status}`)}</Badge>
          )}
          {write && (
            <>
              <Button size="sm" variant="ghost" onClick={onEdit} aria-label={t("patients.plans.editTitle")}>
                <Pencil className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label={t("patients.plans.deletePlan")}>
                <Trash2 className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <CardBody className="flex flex-col gap-4">
        {steps.length === 0 && <p className="text-sm text-muted">{t("patients.plans.noItems")}</p>}
        {steps.map(({ step, items: list }) => (
          <section key={step}>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-primary">{t("patients.plans.stepN", { n: step })}</h4>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {list.map((item) => (
                <li key={item.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className={item.status === "cancelled" ? "text-sm text-muted line-through" : "text-sm font-medium"}>
                      {item.tooth != null && (
                        <span className="mr-1.5 rounded bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-primary">{item.tooth}</span>
                      )}
                      {item.label}
                    </div>
                    <div className="text-xs text-muted">
                      {item.quantity} × {formatGNF(item.unit_price_gnf, locale)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:justify-end">
                    <span className="text-sm font-semibold tabular-nums">{formatGNF(lineTotal(item), locale)}</span>
                    {write ? (
                      <div className="flex items-center gap-1">
                        <Select
                          aria-label={t("patients.plans.status")}
                          value={item.status}
                          onChange={(e) => report(setItemStatus(item, e.target.value as ItemStatus))}
                          className="h-8 w-28"
                        >
                          {ITEM_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {t(`patients.plans.itemStatus.${s}`)}
                            </option>
                          ))}
                        </Select>
                        <Button size="sm" variant="ghost" onClick={() => setItemDialog(item)} aria-label={t("patients.plans.editItem")}>
                          <Pencil className="size-4" />
                        </Button>
                      </div>
                    ) : (
                      <Badge tone={ITEM_TONE[item.status]}>{t(`patients.plans.itemStatus.${item.status}`)}</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {write && (
          <div>
            <Button size="sm" variant="secondary" onClick={() => setItemDialog("new")}>
              <Plus className="size-4" />
              {t("patients.plans.addItem")}
            </Button>
          </div>
        )}

        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-primary-soft p-3 text-center">
          <div>
            <dt className="text-xs text-muted">{t("patients.plans.total")}</dt>
            <dd className="font-semibold tabular-nums">{formatGNF(totals.total, locale)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t("patients.plans.doneTotal")}</dt>
            <dd className="font-semibold tabular-nums text-success">{formatGNF(totals.done, locale)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t("patients.plans.remaining")}</dt>
            <dd className="font-semibold tabular-nums">{formatGNF(totals.remaining, locale)}</dd>
          </div>
        </dl>
      </CardBody>

      <ItemDialog
        key={itemDialog === "new" ? "new" : (itemDialog?.id ?? "none")}
        plan={plan}
        item={itemDialog}
        defaultStep={nextStep}
        onClose={() => setItemDialog(null)}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          for (const it of items) await softDelete("treatment_plan_items", it.id);
          await softDelete("treatment_plans", plan.id);
          toast(t("common.saved"));
        }}
        title={t("patients.plans.deletePlanTitle")}
        message={t("patients.plans.deletePlanMessage")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        danger
      />
    </Card>
  );
}

function PlanDialog({ patientId, plan, onClose }: { patientId: string; plan: Plan | "new" | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { user } = useAuth();
  const existing = plan && plan !== "new" ? plan : null;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [status, setStatus] = useState<PlanStatus>(existing?.status ?? "draft");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) return setError(t("common.required"));
    if (!user) return;
    await mutate("treatment_plans", {
      ...(existing ? { id: existing.id } : { cabinet_id: cabinetId, patient_id: patientId, dentist_id: user.id }),
      title: title.trim(),
      notes: notes.trim() || null,
      status,
    });
    toast(t("patients.plans.saved"));
    onClose();
  }

  return (
    <Dialog
      open={plan != null}
      onClose={onClose}
      title={t(existing ? "patients.plans.editTitle" : "patients.plans.newTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("patients.plans.name")} required error={error}>
          {(p) => <Input {...p} autoFocus value={title} placeholder={t("patients.plans.namePlaceholder")} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label={t("patients.plans.status")}>
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as PlanStatus)}>
              {PLAN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`patients.plans.statusValues.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("patients.plans.notes")}>
          {(p) => <Textarea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}

function ItemDialog({ plan, item, defaultStep, onClose }: { plan: Plan; item: Item | "new" | null; defaultStep: number; onClose: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const existing = item && item !== "new" ? item : null;
  const acts = useLiveQuery(
    async () =>
      (
        await localDb()
          .acts.where("cabinet_id")
          .equals(cabinetId)
          .filter((a) => !a.deleted_at && a.active)
          .toArray()
      ).sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.label.localeCompare(b.label)),
    [cabinetId],
  );
  const [actId, setActId] = useState(existing?.act_id ?? "");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [tooth, setTooth] = useState(existing?.tooth != null ? String(existing.tooth) : "");
  const [step, setStep] = useState(String(existing?.step ?? defaultStep));
  const [quantity, setQuantity] = useState(String(existing?.quantity ?? 1));
  const [price, setPrice] = useState(existing ? String(existing.unit_price_gnf) : "");
  const [status, setStatus] = useState<ItemStatus>(existing?.status ?? "planned");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  function chooseAct(id: string) {
    setActId(id);
    const act = acts?.find((a) => a.id === id);
    if (act) {
      setLabel(act.label);
      setPrice(String(act.price_gnf));
    }
  }

  const priceValue = parseGNF(price || "0");
  const qtyValue = Number(quantity);

  async function save() {
    const e: Record<string, string> = {};
    if (!label.trim()) e.label = t("common.required");
    const toothNum = tooth.trim() ? Number(tooth) : null;
    if (toothNum != null && !isValidTooth(toothNum)) e.tooth = t("patients.plans.invalidTooth");
    if (priceValue == null) e.price = t("patients.plans.invalidPrice");
    if (!Number.isInteger(qtyValue) || qtyValue < 1) e.quantity = t("patients.plans.invalidQuantity");
    const stepNum = Number(step);
    if (!Number.isInteger(stepNum) || stepNum < 1) e.step = t("patients.plans.invalidQuantity");
    setErrors(e);
    if (Object.keys(e).length) return;
    await mutate("treatment_plan_items", {
      ...(existing ? { id: existing.id } : { cabinet_id: cabinetId, plan_id: plan.id }),
      act_id: actId || null,
      label: label.trim(),
      tooth: toothNum,
      step: stepNum,
      quantity: qtyValue,
      unit_price_gnf: priceValue!,
      status,
      done_at: status === "done" ? (existing?.done_at ?? new Date().toISOString()) : null,
    });
    toast(t("common.saved"));
    onClose();
  }

  return (
    <Dialog
      open={item != null}
      onClose={onClose}
      title={t(existing ? "patients.plans.editItem" : "patients.plans.addItem")}
      footer={
        <>
          {existing && (
            <Button variant="ghost" className="mr-auto text-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" />
              {t("patients.plans.deleteItem")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("patients.plans.act")} className="sm:col-span-2" hint={acts && acts.length === 0 ? t("patients.plans.noActs") : undefined}>
          {(p) => (
            <Select {...p} value={actId} onChange={(e) => chooseAct(e.target.value)}>
              <option value="">{t("patients.plans.actFree")}</option>
              {acts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {[a.code, a.label].filter(Boolean).join(" · ")} — {formatGNF(a.price_gnf, locale)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("patients.plans.label")} required error={errors.label} className="sm:col-span-2">
          {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        <Field label={t("patients.plans.tooth")} error={errors.tooth} hint="FDI : 11-48, 51-85">
          {(p) => <Input {...p} inputMode="numeric" value={tooth} placeholder={t("patients.plans.noTooth")} onChange={(e) => setTooth(e.target.value.replace(/\D/g, "").slice(0, 2))} />}
        </Field>
        <Field label={t("patients.plans.step")} error={errors.step}>
          {(p) => <Input {...p} type="number" min={1} inputMode="numeric" value={step} onChange={(e) => setStep(e.target.value)} />}
        </Field>
        <Field label={t("patients.plans.quantity")} error={errors.quantity}>
          {(p) => <Input {...p} type="number" min={1} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}
        </Field>
        <Field label={t("patients.plans.unitPrice")} error={errors.price}>
          {(p) => <Input {...p} inputMode="numeric" value={price} placeholder="0" onChange={(e) => setPrice(e.target.value)} />}
        </Field>
        <Field label={t("patients.plans.status")}>
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
              {ITEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`patients.plans.itemStatus.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex flex-col justify-end">
          <p className="text-sm text-muted">{t("patients.plans.lineTotal")}</p>
          <p className="text-lg font-semibold tabular-nums">
            {formatGNF(priceValue != null && Number.isFinite(qtyValue) ? lineTotal({ quantity: qtyValue, unit_price_gnf: priceValue }) : 0, locale)}
          </p>
        </div>
      </div>
      {existing && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await softDelete("treatment_plan_items", existing.id);
            onClose();
          }}
          title={t("patients.plans.deleteItem")}
          message={existing.label}
          confirmLabel={t("common.delete")}
          cancelLabel={t("common.cancel")}
          danger
        />
      )}
    </Dialog>
  );
}
