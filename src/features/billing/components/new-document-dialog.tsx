"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { localDb, type Row } from "@/lib/local/db";
import { addDays } from "@/lib/dates";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PatientPicker } from "@/features/patients/components/patient-picker";
import { createInvoice, createQuote } from "../actions";
import { planItemsToLines, plannedItems, quoteToInvoiceLines, uninvoicedDoneItems, type DocLine } from "../lib/convert";
import { quoteFigures, sumLines } from "../lib/totals";
import { useDentists } from "../data";
import { useBilling } from "./common";

type Kind = "invoice" | "quote";
type Source = "manual" | "quote" | "plan";

export const QUOTE_VALIDITY_DAYS = 30;

/** Création d'un devis ou d'une facture : saisie libre, depuis un devis accepté ou depuis un plan de traitement. */
export function NewDocumentDialog({
  open,
  onClose,
  kind,
  patientId,
}: {
  open: boolean;
  onClose: () => void;
  kind: Kind;
  patientId?: string;
}) {
  const { t } = useBilling();
  return (
    <Dialog open={open} onClose={onClose} title={t(kind === "invoice" ? "billing.create.invoiceTitle" : "billing.create.quoteTitle")} size="lg">
      {open && <NewDocumentForm kind={kind} initialPatientId={patientId ?? null} onClose={onClose} />}
    </Dialog>
  );
}

function NewDocumentForm({ kind, initialPatientId, onClose }: { kind: Kind; initialPatientId: string | null; onClose: () => void }) {
  const { t, gnf, cabinetId, userId, today, date } = useBilling();
  const { can } = useCabinet();
  const router = useRouter();
  const toast = useToast();
  const dentists = useDentists(cabinetId);
  const [patientId, setPatientId] = useState<string | null>(initialPatientId);
  // null = choix automatique : facture depuis les actes réalisés non facturés s'il y en a, sinon saisie libre.
  const [sourceChoice, setSource] = useState<Source | null>(null);
  const [planChoice, setPlanId] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState<string>("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [dentistId, setDentistId] = useState<string>(can.isDentist && userId ? userId : "");
  const [saving, setSaving] = useState(false);

  const data = useLiveQuery(async () => {
    if (!patientId) return null;
    const db = localDb();
    const [plans, quotes, invoices] = await Promise.all([
      db.treatment_plans.where("patient_id").equals(patientId).toArray(),
      db.quotes.where("patient_id").equals(patientId).toArray(),
      db.invoices.where("patient_id").equals(patientId).toArray(),
    ]);
    const livePlans = plans.filter((p) => p.cabinet_id === cabinetId && !p.deleted_at && p.status !== "cancelled");
    const planItems = livePlans.length ? await db.treatment_plan_items.where("plan_id").anyOf(livePlans.map((p) => p.id)).toArray() : [];
    const liveInvoices = invoices.filter((i) => i.cabinet_id === cabinetId && !i.deleted_at);
    const invoiceItems = liveInvoices.length ? await db.invoice_items.where("invoice_id").anyOf(liveInvoices.map((i) => i.id)).toArray() : [];
    const converted = new Set(liveInvoices.filter((i) => i.quote_id && i.status !== "cancelled").map((i) => i.quote_id!));
    const accepted = quotes.filter((q) => q.cabinet_id === cabinetId && !q.deleted_at && q.status === "accepted" && !converted.has(q.id));
    const quoteItems = accepted.length ? await db.quote_items.where("quote_id").anyOf(accepted.map((q) => q.id)).toArray() : [];
    return { plans: livePlans, planItems, invoices: liveInvoices, invoiceItems, accepted, quoteItems };
  }, [patientId, cabinetId]);

  const plansWithItems = useMemo(() => {
    if (!data) return [];
    return data.plans.filter((p) => {
      const items = data.planItems.filter((i) => i.plan_id === p.id);
      return (kind === "quote" ? plannedItems(items) : uninvoicedDoneItems(items, data.invoiceItems, data.invoices)).length > 0;
    });
  }, [data, kind]);

  const source: Source = sourceChoice ?? (kind === "invoice" && plansWithItems.length > 0 ? "plan" : "manual");
  const planId = planChoice ?? (source === "plan" && plansWithItems.length > 0 ? plansWithItems[0].id : "");

  /** Éléments de plan proposés : prévus (devis) ou réalisés non facturés (facture). */
  const candidates = useMemo(() => {
    if (!data || !planId) return [];
    const items = data.planItems.filter((i) => i.plan_id === planId);
    return kind === "quote" ? plannedItems(items) : uninvoicedDoneItems(items, data.invoiceItems, data.invoices);
  }, [data, planId, kind]);

  const lines: DocLine[] = useMemo(() => {
    if (!data) return [];
    if (source === "plan") return planItemsToLines(candidates.filter((c) => !excluded.has(c.id)), kind === "invoice");
    if (source === "quote" && quoteId) return quoteToInvoiceLines(data.quoteItems.filter((i) => i.quote_id === quoteId));
    return [];
  }, [data, source, candidates, excluded, quoteId, kind]);

  const plan: Row<"treatment_plans"> | undefined = data?.plans.find((p) => p.id === planId);
  const selectedQuote = data?.accepted.find((q) => q.id === quoteId);
  const ready = !!patientId && (source === "manual" || lines.length > 0);

  async function create() {
    if (!patientId) return;
    setSaving(true);
    try {
      const dentist = dentistId || (source === "plan" ? plan?.dentist_id : source === "quote" ? selectedQuote?.dentist_id : null) || null;
      if (kind === "invoice") {
        const id = await createInvoice({
          cabinetId,
          patientId,
          userId,
          today,
          dentistId: dentist,
          quoteId: source === "quote" ? quoteId : null,
          lines,
        });
        onClose();
        router.push(`/app/facturation/facture?id=${id}`);
      } else {
        const id = await createQuote({
          cabinetId,
          patientId,
          userId,
          today,
          validUntil: addDays(today, QUOTE_VALIDITY_DAYS),
          dentistId: dentist,
          planId: source === "plan" ? planId : null,
          lines,
        });
        onClose();
        router.push(`/app/facturation/devis?id=${id}`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  const sources: { value: Source; label: string; disabled: boolean }[] = [
    { value: "manual", label: t("billing.create.manual"), disabled: false },
    ...(kind === "invoice"
      ? [{ value: "quote" as const, label: t("billing.create.fromQuote"), disabled: !data?.accepted.length }]
      : []),
    {
      value: "plan",
      label: t(kind === "invoice" ? "billing.create.fromPlanDone" : "billing.create.fromPlan"),
      disabled: !plansWithItems.length,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Field label={t("billing.fields.patient")} required>
        {() => (
          <PatientPicker
            value={patientId}
            onChange={(p) => {
              setPatientId(p?.id ?? null);
              setSource(null);
              setPlanId(null);
              setQuoteId("");
            }}
            autoFocus={!patientId}
          />
        )}
      </Field>

      {patientId && (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("billing.create.source")}</legend>
            {sources.map((s) => (
              <label key={s.value} className={`flex items-center gap-2 text-sm ${s.disabled ? "opacity-50" : ""}`}>
                <input
                  type="radio"
                  name="source"
                  className="size-4 accent-primary"
                  checked={source === s.value}
                  disabled={s.disabled}
                  onChange={() => {
                    setSource(s.value);
                    setExcluded(new Set());
                    if (s.value === "plan") setPlanId(plansWithItems.length === 1 ? plansWithItems[0].id : null);
                    if (s.value === "quote" && data?.accepted.length === 1) setQuoteId(data.accepted[0].id);
                  }}
                />
                {s.label}
                {s.disabled && s.value !== "manual" && (
                  <span className="text-xs text-muted">
                    ({t(s.value === "quote" ? "billing.create.noAcceptedQuote" : kind === "invoice" ? "billing.create.noDoneItems" : "billing.create.noPlan")})
                  </span>
                )}
              </label>
            ))}
          </fieldset>

          {source === "quote" && data && (
            <Field label={t("billing.create.chooseQuote")}>
              {(p) => (
                <Select {...p} value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
                  <option value="">—</option>
                  {data.accepted.map((q) => (
                    <option key={q.id} value={q.id}>
                      {(q.number ?? t("billing.provisionalNumber")) + " · " + date(q.issue_date) + " · " + gnf(quoteFigures(q, data.quoteItems.filter((i) => i.quote_id === q.id)).total)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          {source === "plan" && (
            <>
              <Field label={t("billing.create.choosePlan")}>
                {(p) => (
                  <Select
                    {...p}
                    value={planId}
                    onChange={(e) => {
                      setPlanId(e.target.value);
                      setExcluded(new Set());
                    }}
                  >
                    <option value="">—</option>
                    {plansWithItems.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.title}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {candidates.length > 0 && (
                <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
                  <div className="mb-1 text-xs text-muted">{t("billing.create.selectItems")}</div>
                  {candidates.map((c) => (
                    <Checkbox
                      key={c.id}
                      checked={!excluded.has(c.id)}
                      onChange={(e) =>
                        setExcluded((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.delete(c.id);
                          else n.add(c.id);
                          return n;
                        })
                      }
                      label={
                        <span>
                          {c.label}
                          {c.tooth ? ` (${c.tooth})` : ""} · {c.quantity} × {gnf(c.unit_price_gnf)}
                        </span>
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {(dentists?.length ?? 0) > 0 && (
            <Field label={t("billing.fields.dentist")}>
              {(p) => (
                <Select {...p} value={dentistId} onChange={(e) => setDentistId(e.target.value)}>
                  <option value="">{source === "manual" ? "—" : t("billing.create.dentistFromSource")}</option>
                  {dentists!.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          {lines.length > 0 && (
            <div className="text-right text-sm">
              {t("billing.create.linesSummary", { count: lines.length })} · <strong>{gnf(sumLines(lines))}</strong>
            </div>
          )}
        </>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={create} disabled={!ready} loading={saving}>
          {t("common.create")}
        </Button>
      </div>
    </div>
  );
}
