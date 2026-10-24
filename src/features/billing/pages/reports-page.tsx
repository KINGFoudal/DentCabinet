"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { formatTime, fullName } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, PageSpinner } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { RequirePermission } from "@/components/app/app-gate";
import { useBillingData, useMemberNames } from "../data";
import { countsAsRevenue } from "../lib/totals";
import { byDentist, byPaymentMethod, inPeriod, localDate, presetRange, revenueByDay, topActs, type PeriodPreset } from "../lib/reports";
import { downloadCSV, toCSV } from "../lib/csv";
import { Kpi, useBilling } from "../components/common";

const PRESETS: PeriodPreset[] = ["today", "last30", "thisMonth", "lastMonth", "thisYear"];

/** Rapports financiers (/app/rapports) : administrateur et comptable. */
export default function ReportsPage() {
  const { can } = useBilling();
  return (
    <RequirePermission allowed={can.reports}>
      <ReportsScreen />
    </RequirePermission>
  );
}

function Bar({ value, max, tone = "primary" }: { value: number; max: number; tone?: "primary" | "success" }) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-primary-soft">
      <div className={`h-2 rounded-full ${tone === "success" ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ReportsScreen() {
  const { t, gnf, date, cabinetId, today, tz } = useBilling();
  const data = useBillingData(cabinetId);
  const names = useMemberNames(cabinetId);
  const [preset, setPreset] = useState<PeriodPreset | "custom">("thisMonth");
  const [custom, setCustom] = useState<[string, string]>(() => presetRange("thisMonth", today));
  const [from, to] = preset === "custom" ? custom : presetRange(preset, today);

  const report = useMemo(() => {
    if (!data) return null;
    const invoices = data.invoices.filter((v) => inPeriod(v.invoice.issue_date, from, to));
    const counted = invoices.filter((v) => countsAsRevenue(v.figures.status));
    const payments = data.payments.filter((p) => inPeriod(localDate(p.paid_at, tz), from, to));
    const succeeded = payments.filter((p) => p.status === "succeeded");
    const asReport = counted.map((v) => ({
      id: v.invoice.id,
      issue_date: v.invoice.issue_date,
      status: v.figures.status,
      total: v.figures.total,
      dentist_id: v.invoice.dentist_id,
    }));
    return {
      invoices,
      payments: succeeded,
      invoiced: counted.reduce((s, v) => s + v.figures.total, 0),
      collected: succeeded.reduce((s, p) => s + Number(p.amount_gnf), 0),
      outstanding: counted.reduce((s, v) => s + v.figures.balance, 0),
      count: counted.length,
      days: revenueByDay(asReport, succeeded, from, to, tz),
      methods: byPaymentMethod(succeeded),
      dentists: byDentist(asReport),
      acts: topActs(data.invoiceItems, new Set(counted.map((v) => v.invoice.id)), 10),
      provisional: invoices.some((v) => v.figures.provisional),
    };
  }, [data, from, to, tz]);

  if (!data || !report) return <PageSpinner />;

  const invoiceById = new Map(data.invoices.map((v) => [v.invoice.id, v]));
  const activeDays = report.days.filter((d) => d.invoiced || d.collected);
  const maxDay = Math.max(0, ...report.days.map((d) => Math.max(d.invoiced, d.collected)));
  const maxMethod = Math.max(0, ...report.methods.map((m) => m.amount));
  const maxDentist = Math.max(0, ...report.dentists.map((d) => d.amount));
  const maxAct = Math.max(0, ...report.acts.map((a) => a.quantity));

  function exportInvoices() {
    const header = [
      t("billing.csv.number"),
      t("billing.csv.issueDate"),
      t("billing.csv.dueDate"),
      t("billing.csv.patient"),
      t("billing.csv.fileNumber"),
      t("billing.csv.status"),
      t("billing.csv.total"),
      t("billing.csv.paid"),
      t("billing.csv.balance"),
      t("billing.csv.dentist"),
      t("billing.csv.provisional"),
    ];
    const rows = report!.invoices
      .filter((v) => v.figures.status !== "draft")
      .map((v) => [
        v.invoice.number ?? "",
        v.invoice.issue_date,
        v.invoice.due_date ?? "",
        v.patient ? fullName(v.patient) : "",
        v.patient?.file_number ?? "",
        t(`billing.invoiceStatus.${v.figures.status}`),
        v.figures.total,
        v.figures.paid,
        v.figures.balance,
        (v.invoice.dentist_id && names?.get(v.invoice.dentist_id)) || "",
        v.figures.provisional ? t("common.yes") : "",
      ]);
    downloadCSV(`factures_${from}_${to}.csv`, toCSV(header, rows));
  }

  function exportPayments() {
    const header = [
      t("billing.csv.paidAt"),
      t("billing.csv.invoice"),
      t("billing.csv.patient"),
      t("billing.csv.amount"),
      t("billing.csv.method"),
      t("billing.csv.reference"),
      t("billing.csv.receivedBy"),
    ];
    const rows = report!.payments.map((p) => {
      const v = invoiceById.get(p.invoice_id);
      return [
        `${localDate(p.paid_at, tz)} ${formatTime(p.paid_at, "fr", tz)}`,
        v?.invoice.number ?? "",
        v?.patient ? fullName(v.patient) : "",
        Number(p.amount_gnf),
        t(`billing.method.${p.method}`),
        p.reference ?? "",
        (p.received_by && names?.get(p.received_by)) || "",
      ];
    });
    downloadCSV(`paiements_${from}_${to}.csv`, toCSV(header, rows));
  }

  return (
    <>
      <PageHeader
        title={t("billing.reports.title")}
        subtitle={`${date(from)} – ${date(to)}`}
        actions={
          <>
            <Button variant="secondary" onClick={exportInvoices}>
              <Download className="size-4" />
              {t("billing.reports.exportInvoices")}
            </Button>
            <Button variant="secondary" onClick={exportPayments}>
              <Download className="size-4" />
              {t("billing.reports.exportPayments")}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("billing.reports.period")}
          <Select value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset | "custom")} className="w-48">
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {t(`billing.reports.presets.${p}`)}
              </option>
            ))}
            <option value="custom">{t("billing.reports.presets.custom")}</option>
          </Select>
        </label>
        {preset === "custom" && (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t("billing.filters.from")}
              <Input type="date" value={custom[0]} max={custom[1]} onChange={(e) => e.target.value && setCustom([e.target.value, custom[1]])} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t("billing.filters.to")}
              <Input type="date" value={custom[1]} min={custom[0]} onChange={(e) => e.target.value && setCustom([custom[0], e.target.value])} />
            </label>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("billing.reports.invoiced")} value={gnf(report.invoiced)} hint={t("billing.reports.invoiceCount", { count: report.count })} />
        <Kpi label={t("billing.reports.collected")} value={gnf(report.collected)} tone="success" hint={t("billing.reports.paymentCount", { count: report.payments.length })} />
        <Kpi label={t("billing.reports.outstanding")} value={gnf(report.outstanding)} tone={report.outstanding ? "danger" : undefined} />
        <Kpi
          label={t("billing.reports.collectionRate")}
          value={report.invoiced ? `${Math.round((report.collected / report.invoiced) * 100)} %` : "—"}
        />
      </div>
      {report.provisional && <p className="mt-1 text-xs italic text-warning">{t("billing.kpi.provisional")}</p>}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title={t("billing.reports.byDay")} />
          <CardBody className="max-h-96 overflow-y-auto p-0">
            <div className="flex gap-4 px-4 pt-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-primary" /> {t("billing.reports.invoiced")}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-success" /> {t("billing.reports.collected")}
              </span>
            </div>
            {activeDays.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">{t("billing.reports.empty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {activeDays.map((d) => (
                  <li key={d.date} className="flex flex-col gap-1 px-4 py-2 text-xs">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium">{date(d.date)}</span>
                      <span className="whitespace-nowrap">
                        {gnf(d.invoiced)} · <span className="text-success">{gnf(d.collected)}</span>
                      </span>
                    </div>
                    <Bar value={d.invoiced} max={maxDay} />
                    <Bar value={d.collected} max={maxDay} tone="success" />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("billing.reports.byMethod")} />
          <CardBody>
            {report.methods.length === 0 ? (
              <p className="text-sm text-muted">{t("billing.reports.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {report.methods.map((m) => (
                  <li key={m.method} className="text-sm">
                    <div className="mb-1 flex justify-between gap-2">
                      <span>
                        {t(`billing.method.${m.method}`)} <span className="text-xs text-muted">({m.count})</span>
                      </span>
                      <span className="whitespace-nowrap font-medium">{gnf(m.amount)}</span>
                    </div>
                    <Bar value={m.amount} max={maxMethod} tone="success" />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("billing.reports.byDentist")} />
          <CardBody>
            {report.dentists.length === 0 ? (
              <p className="text-sm text-muted">{t("billing.reports.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {report.dentists.map((d) => (
                  <li key={d.dentist_id ?? "none"} className="text-sm">
                    <div className="mb-1 flex justify-between gap-2">
                      <span>
                        {(d.dentist_id && names?.get(d.dentist_id)) || t("billing.reports.unassigned")}{" "}
                        <span className="text-xs text-muted">({d.count})</span>
                      </span>
                      <span className="whitespace-nowrap font-medium">{gnf(d.amount)}</span>
                    </div>
                    <Bar value={d.amount} max={maxDentist} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t("billing.reports.topActs")} />
          <CardBody>
            {report.acts.length === 0 ? (
              <p className="text-sm text-muted">{t("billing.reports.empty")}</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {report.acts.map((a, i) => (
                  <li key={a.key} className="text-sm">
                    <div className="mb-1 flex justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="mr-2 text-xs text-muted">{i + 1}.</span>
                        {a.label}
                      </span>
                      <span className="whitespace-nowrap">
                        <span className="font-medium">× {a.quantity}</span> <span className="text-xs text-muted">· {gnf(a.amount)}</span>
                      </span>
                    </div>
                    <Bar value={a.quantity} max={maxAct} />
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
