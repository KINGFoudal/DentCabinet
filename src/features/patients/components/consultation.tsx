"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, CheckCircle2, Plus, Printer, Stethoscope, Trash2 } from "lucide-react";
import { localDb } from "@/lib/local/db";
import { mutate } from "@/lib/sync/mutate";
import { dayBounds, todayISO } from "@/lib/dates";
import { CABINET_TIMEZONE, formatGNF, formatTime, fullName } from "@/lib/format";
import { useAuth } from "@/lib/auth/auth-provider";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { RequirePermission } from "@/components/app/app-gate";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageSpinner } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createInvoice, issueInvoice } from "@/features/billing/actions";
import { useActs } from "@/features/billing/data";
import { uninvoicedDoneItems } from "@/features/billing/lib/convert";
import { buildPrescription, emptyRxItem, type RxItem } from "../lib/clinical";
import { checkConsultation, consultationHref, consultationPrintHref, parseActDraft, pickConsultationAppointment, type ActDraft } from "../lib/consultation";
import { usePatient } from "../lib/hooks";
import { MedicalAlertsBanner } from "./medical-alerts";
import { RxEditor } from "./rx-editor";

/** Bouton « Terminer la consultation » (fiche patient ; réutilisable depuis un rendez-vous). */
export function FinishConsultationButton({
  patientId,
  appointmentId,
  size = "sm",
  className,
  compact,
}: {
  patientId: string;
  appointmentId?: string | null;
  size?: "sm" | "md";
  className?: string;
  /** Icône seule sur téléphone (liste serrée), libellé à partir de sm. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { can } = useCabinet();
  if (!can.clinicalWrite || !can.billingWrite) return null;
  const label = t("patients.consult.action");
  return (
    <Link
      href={consultationHref(patientId, appointmentId)}
      className={buttonClass("primary", size, className)}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
    >
      <Stethoscope className="size-4 shrink-0" />
      {compact ? <span className="hidden sm:inline">{label}</span> : label}
    </Link>
  );
}

/** Écran « Terminer la consultation » (lit ?patient= et ?appointment= ; à rendre sous <Suspense>). */
export function ConsultationScreen() {
  const params = useSearchParams();
  const { can } = useCabinet();
  const patientId = params.get("patient");
  return (
    <RequirePermission allowed={can.clinicalWrite && can.billingWrite}>
      <Consultation key={patientId ?? "none"} patientId={patientId} appointmentParam={params.get("appointment")} />
    </RequirePermission>
  );
}

let seq = 0;
const newKey = () => `a${++seq}`;
const blankAct = (): ActDraft => ({ key: newKey(), act_id: null, label: "", tooth: "", quantity: "1", price: "" });

function Consultation({ patientId, appointmentParam }: { patientId: string | null; appointmentParam: string | null }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const cabinetId = useCabinetId();
  const { cabinet, can } = useCabinet();
  const { user } = useAuth();
  const tz = cabinet?.timezone ?? CABINET_TIMEZONE;
  const today = todayISO(tz);
  const patient = usePatient(cabinetId, patientId);
  const acts = useActs(cabinetId);
  const activeActs = useMemo(() => (acts ?? []).filter((a) => a.active), [acts]);
  const categories = useMemo(() => [...new Set(activeActs.map((a) => a.category || ""))], [activeActs]);

  const context = useLiveQuery(async () => {
    if (!patientId) return null;
    const db = localDb();
    const [start, end] = dayBounds(today, tz);
    const [appts, plans, invoices, medical] = await Promise.all([
      db.appointments.where("patient_id").equals(patientId).toArray(),
      db.treatment_plans.where("patient_id").equals(patientId).toArray(),
      db.invoices.where("patient_id").equals(patientId).toArray(),
      can.medical ? db.patient_medical.get(patientId) : undefined,
    ]);
    const mine = appts.filter((a) => a.cabinet_id === cabinetId && !a.deleted_at);
    const todays = mine
      .filter((a) => a.starts_at >= start && a.starts_at < end && a.status !== "cancelled" && a.status !== "no_show")
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const param = appointmentParam ? mine.find((a) => a.id === appointmentParam) : undefined;
    const livePlans = plans.filter((p) => p.cabinet_id === cabinetId && !p.deleted_at && p.status !== "cancelled");
    const planItems = livePlans.length ? await db.treatment_plan_items.where("plan_id").anyOf(livePlans.map((p) => p.id)).toArray() : [];
    const liveInvoices = invoices.filter((i) => i.cabinet_id === cabinetId && !i.deleted_at);
    const invoiceItems = liveInvoices.length ? await db.invoice_items.where("invoice_id").anyOf(liveInvoices.map((i) => i.id)).toArray() : [];
    return {
      appointments: param && !todays.some((a) => a.id === param.id) ? [param, ...todays] : todays,
      suggested: param ?? pickConsultationAppointment(mine, patientId, start, end),
      planDone: uninvoicedDoneItems(planItems, invoiceItems, liveInvoices),
      medical: medical && medical.cabinet_id === cabinetId && !medical.deleted_at ? medical : null,
    };
  }, [patientId, cabinetId, today, tz, appointmentParam, can.medical]);

  const [drafts, setDrafts] = useState<ActDraft[]>([]);
  const [mode, setMode] = useState<"issued" | "draft">("issued");
  const [withRx, setWithRx] = useState(true);
  const [rxItems, setRxItems] = useState<RxItem[]>([{ ...emptyRxItem }]);
  const [notes, setNotes] = useState("");
  const [shared, setShared] = useState(true);
  const [apptChoice, setApptChoice] = useState<string | null>(null);
  const [markDone, setMarkDone] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (patient === undefined || context === undefined || acts === undefined) return <PageSpinner />;
  if (!patient || !context || patient.deleted_at) return <p className="p-6 text-center text-muted">{t("patients.file.notFound")}</p>;

  const appointmentId = apptChoice ?? context.suggested?.id ?? "";
  const appointment = context.appointments.find((a) => a.id === appointmentId) ?? null;
  const total = drafts.reduce((s, d, i) => {
    const l = parseActDraft(d, i);
    return s + (l ? l.quantity * l.unit_price_gnf : 0);
  }, 0);
  const gnf = (n: number) => formatGNF(n, locale);
  const update = (key: string, patch: Partial<ActDraft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  function addAct(actId: string) {
    const act = activeActs.find((a) => a.id === actId);
    if (!act) return;
    setDrafts((ds) => [...ds.filter((d) => d.label.trim() || d.price.trim()), { key: newKey(), act_id: act.id, label: act.label, tooth: "", quantity: "1", price: String(act.price_gnf) }]);
  }

  function togglePlanItem(id: string, on: boolean) {
    const item = context!.planDone.find((p) => p.id === id);
    if (!item) return;
    setDrafts((ds) =>
      on
        ? [...ds, { key: newKey(), act_id: item.act_id, plan_item_id: item.id, label: item.label, tooth: item.tooth == null ? "" : String(item.tooth), quantity: String(item.quantity), price: String(item.unit_price_gnf) }]
        : ds.filter((d) => d.plan_item_id !== id),
    );
  }

  async function finish(print: boolean) {
    if (!user || !patient || saving) return;
    const check = checkConsultation(drafts, rxItems, withRx);
    if (!check.ok) return setError(t(`patients.consult.${check.error}`));
    setError(null);
    setSaving(true);
    try {
      let invoiceId: string | null = null;
      if (check.lines.length) {
        invoiceId = await createInvoice({
          cabinetId,
          patientId: patient.id,
          userId: user.id,
          today,
          dentistId: user.id,
          appointmentId: appointment?.id ?? null,
          lines: check.lines,
        });
        if (mode === "issued") await issueInvoice(invoiceId, today);
      }
      let rxId: string | null = null;
      if (check.rxItems.length) {
        const built = buildPrescription({
          cabinetId,
          patientId: patient.id,
          dentistId: user.id,
          items: check.rxItems,
          notes,
          shared,
          invoiceId,
          appointmentId: appointment?.id ?? null,
        });
        if (built.row) rxId = (await mutate("prescriptions", built.row)).id;
      }
      if (appointment && markDone && appointment.status !== "done") {
        await mutate("appointments", { id: appointment.id, status: "done", arrived_at: appointment.arrived_at ?? new Date().toISOString() });
      }
      toast(t("patients.consult.done"));
      router.push(print ? consultationPrintHref({ patientId: patient.id, invoiceId, rxId }) : `/app/patients/fiche?id=${patient.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-4"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void finish(true);
        }
      }}
    >
      <Link href={`/app/patients/fiche?id=${patient.id}`} className="inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-primary">
        <ArrowLeft className="size-4" />
        {t("patients.consult.backToFile")}
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold sm:text-2xl">{t("patients.consult.title")}</h1>
        <p className="text-sm text-muted">
          {fullName(patient)}
          {patient.file_number ? ` · ${patient.file_number}` : ""}
        </p>
      </header>
      {context.medical && <MedicalAlertsBanner alerts={context.medical.alerts} allergies={context.medical.allergies} />}

      {context.appointments.length > 0 && (
        <Card>
          <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label={t("patients.consult.appointment")} className="sm:w-80">
              {(p) => (
                <Select {...p} value={appointmentId} onChange={(e) => setApptChoice(e.target.value)}>
                  <option value="">{t("patients.consult.noAppointment")}</option>
                  {context.appointments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {formatTime(a.starts_at, locale, tz)}
                      {a.title ? ` · ${a.title}` : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {appointment && appointment.status !== "done" && (
              <Checkbox className="sm:pb-2.5" label={t("patients.consult.markDone")} checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} />
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t("patients.consult.acts")} />
        <CardBody className="flex flex-col gap-3">
          <p className="text-xs text-muted">{t("patients.consult.actsHint")}</p>
          {context.planDone.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
              <div className="mb-1 text-xs text-muted">{t("patients.consult.planDone")}</div>
              {context.planDone.map((p) => (
                <Checkbox
                  key={p.id}
                  checked={drafts.some((d) => d.plan_item_id === p.id)}
                  onChange={(e) => togglePlanItem(p.id, e.target.checked)}
                  label={
                    <span>
                      {p.label}
                      {p.tooth ? ` (${p.tooth})` : ""} · {p.quantity} × {gnf(p.unit_price_gnf)}
                    </span>
                  }
                />
              ))}
            </div>
          )}
          {activeActs.length > 0 && (
            <Select aria-label={t("patients.consult.chooseAct")} value="" onChange={(e) => addAct(e.target.value)}>
              <option value="">{t("patients.consult.chooseAct")}</option>
              {categories.map((c) => (
                <optgroup key={c} label={c || "—"}>
                  {activeActs
                    .filter((a) => (a.category || "") === c)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code ? `${a.code} – ` : ""}
                        {a.label} · {gnf(a.price_gnf)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          )}
          {drafts.length === 0 ? (
            <p className="text-sm text-muted">{t("patients.consult.noActs")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {drafts.map((d) => (
                <li key={d.key} className="grid grid-cols-6 items-end gap-2 rounded-lg border border-border p-2 sm:grid-cols-12">
                  <label className="col-span-6 flex flex-col gap-1 text-xs text-muted sm:col-span-6">
                    {t("patients.consult.freeAct")}
                    <Input value={d.label} onChange={(e) => update(d.key, { label: e.target.value })} />
                  </label>
                  <label className="col-span-2 flex flex-col gap-1 text-xs text-muted sm:col-span-1">
                    {t("patients.consult.tooth")}
                    <Input inputMode="numeric" value={d.tooth} placeholder="16" onChange={(e) => update(d.key, { tooth: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
                  </label>
                  <label className="col-span-1 flex flex-col gap-1 text-xs text-muted sm:col-span-1">
                    {t("patients.consult.qty")}
                    <Input inputMode="numeric" value={d.quantity} onChange={(e) => update(d.key, { quantity: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
                  </label>
                  <label className="col-span-2 flex flex-col gap-1 text-xs text-muted sm:col-span-3">
                    {t("patients.consult.price")}
                    <Input inputMode="numeric" value={d.price} placeholder="150 000" onChange={(e) => update(d.key, { price: e.target.value })} />
                  </label>
                  <div className="col-span-1 flex justify-end">
                    <Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}>
                      <Trash2 className="size-4 text-danger" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button size="sm" variant="secondary" onClick={() => setDrafts((ds) => [...ds, blankAct()])}>
              <Plus className="size-4" />
              {t("patients.consult.addAct")}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("patients.consult.invoice")} />
        <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <fieldset className="flex flex-col gap-2 sm:flex-row sm:gap-4">
            {(["issued", "draft"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input type="radio" name="invoice-mode" className="size-4 accent-primary" checked={mode === m} onChange={() => setMode(m)} />
                {t(m === "issued" ? "patients.consult.invoiceIssue" : "patients.consult.invoiceDraft")}
              </label>
            ))}
          </fieldset>
          <div className="text-base font-semibold">
            {t("patients.consult.total")} : {gnf(total)}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("patients.consult.rx")} actions={<Checkbox label={t("patients.consult.noRx")} checked={!withRx} onChange={(e) => setWithRx(!e.target.checked)} />} />
        {withRx && (
          <CardBody className="flex flex-col gap-3">
            <RxEditor patientId={patient.id} items={rxItems} onChange={setRxItems} autoFocus={false} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("patients.rx.notes")}>
                {(p) => <Textarea {...p} rows={2} className="!min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />}
              </Field>
              <Checkbox className="sm:self-center" label={t("patients.rx.shared")} checked={shared} onChange={(e) => setShared(e.target.checked)} />
            </div>
          </CardBody>
        )}
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 rounded-xl border border-border bg-surface px-4 py-3 sm:sticky sm:bottom-0 sm:z-10">
        <Button variant="secondary" onClick={() => finish(false)} loading={saving}>
          <CheckCircle2 className="size-4" />
          {t("patients.consult.finishNoPrint")}
        </Button>
        <Button onClick={() => finish(true)} loading={saving}>
          <Printer className="size-4" />
          {t("patients.consult.finish")}
        </Button>
      </div>
    </div>
  );
}
