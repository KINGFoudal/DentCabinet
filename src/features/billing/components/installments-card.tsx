"use client";

import { useState } from "react";
import { CalendarClock, Trash2 } from "lucide-react";
import { parseGNF } from "@/lib/format";
import { addDays } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { addInstallment, removeInstallment, replaceInstallments } from "../actions";
import { allocateInstallments, splitSchedule } from "../lib/installments";
import type { InvoiceView } from "../data";
import { InstallmentBadge, useBilling } from "./common";
import { useReportWrite } from "@/lib/sync/report-write";

/** Échéancier d'une facture : échéances, part déjà couverte, retards. */
export function InstallmentsCard({ view, editable }: { view: InvoiceView; editable: boolean }) {
  const report = useReportWrite();
  const { t, gnf, date, today, cabinetId } = useBilling();
  const [open, setOpen] = useState(false);
  const allocated = allocateInstallments(view.installments, view.figures.paid, today, view.figures.total);
  const scheduled = allocated.reduce((s, i) => s + Number(i.amount_gnf), 0);
  const { total } = view.figures;

  if (!allocated.length && !editable) return null;

  return (
    <Card className="no-print">
      <CardHeader
        title={t("billing.installments.title")}
        actions={
          editable && (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              <CalendarClock className="size-4" />
              {allocated.length ? t("billing.installments.edit") : t("billing.installments.create")}
            </Button>
          )
        }
      />
      <CardBody className="p-0">
        {allocated.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">{t("billing.installments.empty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {allocated.map((i) => (
              <li key={i.id} className={`flex flex-wrap items-center gap-2 px-4 py-2 text-sm ${i.state === "overdue" ? "bg-danger-soft" : ""}`}>
                <span className={`w-28 ${i.state === "overdue" ? "font-semibold text-danger" : ""}`}>{date(i.due_date)}</span>
                <span className="flex-1 font-medium">{gnf(i.amount_gnf)}</span>
                {i.state === "partial" || (i.state === "overdue" && i.covered > 0) ? (
                  <span className="text-xs text-muted">{t("billing.installments.remaining", { amount: gnf(i.remaining) })}</span>
                ) : null}
                <InstallmentBadge state={i.state} />
                {editable && (
                  <Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => report(removeInstallment(i.id))}>
                    <Trash2 className="size-4 text-danger" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {allocated.length > 0 && scheduled > total && (
          <p className="border-t border-border px-4 py-2 text-xs text-warning">
            {t("billing.installments.mismatch", { scheduled: gnf(scheduled), total: gnf(total) })}
          </p>
        )}
      </CardBody>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("billing.installments.title")}>
        {open && (
          <ScheduleForm
            total={total}
            paid={view.figures.paid}
            onCancel={() => setOpen(false)}
            onSave={async (mode, rows) => {
              if (mode === "replace") await replaceInstallments(cabinetId, view.invoice.id, view.installments, rows);
              else for (const r of rows) await addInstallment(cabinetId, view.invoice.id, r);
              setOpen(false);
            }}
            defaultFirst={addDays(today, 30)}
          />
        )}
      </Dialog>
    </Card>
  );
}

function ScheduleForm({
  total,
  paid,
  defaultFirst,
  onCancel,
  onSave,
}: {
  total: number;
  paid: number;
  defaultFirst: string;
  onCancel: () => void;
  onSave: (mode: "replace" | "add", rows: { due_date: string; amount_gnf: number }[]) => Promise<void>;
}) {
  const { t, gnf, date } = useBilling();
  const toast = useToast();
  const [mode, setMode] = useState<"replace" | "add">("replace");
  const [amount, setAmount] = useState(String(Math.max(0, total - paid)));
  const [count, setCount] = useState("3");
  const [first, setFirst] = useState(defaultFirst);
  const [step, setStep] = useState("1");
  const [saving, setSaving] = useState(false);

  const value = parseGNF(amount) ?? 0;
  const n = mode === "add" ? 1 : Math.max(1, Math.min(24, Number(count) || 1));
  let preview: { due_date: string; amount_gnf: number }[] = [];
  let error: string | null = null;
  try {
    preview = first ? splitSchedule(value, n, first, Number(step) || 1) : [];
  } catch {
    error = t("billing.installments.tooSmall");
  }
  if (!error && value <= 0) error = t("billing.payment.amountInvalid");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-4 text-sm">
        {(["replace", "add"] as const).map((m) => (
          <label key={m} className="flex items-center gap-2">
            <input type="radio" className="size-4 accent-primary" checked={mode === m} onChange={() => setMode(m)} />
            {t(m === "replace" ? "billing.installments.modeSplit" : "billing.installments.modeAdd")}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("billing.fields.amount")} className="col-span-2" hint={t("billing.installments.amountHint", { balance: gnf(Math.max(0, total - paid)) })}>
          {(p) => <Input {...p} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        {mode === "replace" && (
          <>
            <Field label={t("billing.installments.count")}>
              {(p) => <Input {...p} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 2))} />}
            </Field>
            <Field label={t("billing.installments.every")}>
              {(p) => (
                <Select {...p} value={step} onChange={(e) => setStep(e.target.value)}>
                  <option value="1">{t("billing.installments.monthly")}</option>
                  <option value="2">{t("billing.installments.everyN", { n: 2 })}</option>
                  <option value="3">{t("billing.installments.everyN", { n: 3 })}</option>
                </Select>
              )}
            </Field>
          </>
        )}
        <Field label={t(mode === "replace" ? "billing.installments.first" : "billing.fields.dueDate")} className="col-span-2">
          {(p) => <Input {...p} type="date" value={first} onChange={(e) => setFirst(e.target.value)} />}
        </Field>
      </div>
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <ul className="rounded-lg border border-border text-sm">
          {preview.map((r, i) => (
            <li key={i} className="flex justify-between border-b border-border px-3 py-1.5 last:border-b-0">
              <span>{date(r.due_date)}</span>
              <span className="font-medium">{gnf(r.amount_gnf)}</span>
            </li>
          ))}
        </ul>
      )}
      {mode === "replace" && <p className="text-xs text-muted">{t("billing.installments.replaceHint")}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          disabled={!!error || preview.length === 0}
          loading={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(mode, preview);
              toast(t("common.saved"));
            } catch (e) {
              toast(e instanceof Error ? e.message : t("common.error"), "error");
            } finally {
              setSaving(false);
            }
          }}
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
