"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessageCircle, Plus, Wallet } from "lucide-react";
import { fullName, formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, PageSpinner } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/app/app-gate";
import { searchKey } from "@/features/patients/components/patient-picker";
import { useBillingData, type InvoiceView } from "../data";
import { countsAsRevenue, daysBetween, displayQuoteStatus, type InvoiceStatus, type QuoteStatus } from "../lib/totals";
import { allocateInstallments, overdueAmount } from "../lib/installments";
import { localDate } from "../lib/reports";
import { whatsappLink } from "../lib/whatsapp";
import { DocNumber, Kpi, useBilling } from "../components/common";
import { InvoiceList, QuoteList } from "../components/document-lists";
import { NewDocumentDialog } from "../components/new-document-dialog";
import { useCollectAction } from "../components/collect-action";

type Tab = "factures" | "devis" | "impayes";
const TABS: Tab[] = ["factures", "devis", "impayes"];

export default function BillingPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <BillingScreen />
    </Suspense>
  );
}

function matches(patient: { first_name: string; last_name: string; file_number: string | null; phone: string | null } | undefined, number: string | null, q: string) {
  const query = searchKey(q.trim());
  if (!query) return true;
  const hay = searchKey(`${patient ? `${patient.first_name} ${patient.last_name} ${patient.last_name} ${patient.first_name} ${patient.file_number ?? ""}` : ""} ${number ?? ""}`);
  const digits = q.replace(/\D/g, "");
  return hay.includes(query) || (digits.length >= 3 && (patient?.phone ?? "").includes(digits));
}

function BillingScreen() {
  const { t, gnf, can, canWrite, cabinetId, today, tz } = useBilling();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = params.get("onglet") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "factures";
  const data = useBillingData(cabinetId);
  const [creating, setCreating] = useState<"invoice" | "quote" | null>(null);
  const [status, setStatus] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");

  const setTab = (v: Tab) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("onglet", v);
    setStatus("");
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const kpis = useMemo(() => {
    if (!data) return null;
    const month = today.slice(0, 7);
    let day = 0,
      monthRevenue = 0,
      unpaid = 0;
    for (const v of data.invoices) {
      if (!countsAsRevenue(v.figures.status)) continue;
      if (v.invoice.issue_date === today) day += v.figures.total;
      if (v.invoice.issue_date.startsWith(month)) monthRevenue += v.figures.total;
      unpaid += v.figures.balance;
    }
    const collected = data.payments
      .filter((p) => p.status === "succeeded" && localDate(p.paid_at, tz).startsWith(month))
      .reduce((s, p) => s + Number(p.amount_gnf), 0);
    const provisional = data.invoices.some((v) => v.figures.provisional);
    return { day, monthRevenue, unpaid, collected, provisional };
  }, [data, today, tz]);

  if (!can.billingRead) return <RequirePermission allowed={false}>{null}</RequirePermission>;

  const inPeriod = (d: string) => (!from || d >= from) && (!to || d <= to);
  const invoices = (data?.invoices ?? []).filter(
    (v) => (!status || v.figures.status === status) && inPeriod(v.invoice.issue_date) && matches(v.patient, v.invoice.number, query),
  );
  const quotes = (data?.quotes ?? []).filter(
    (v) => (!status || displayQuoteStatus(v.quote, today) === status) && inPeriod(v.quote.issue_date) && matches(v.patient, v.quote.number, query),
  );
  const unpaid = (data?.invoices ?? [])
    .filter((v) => v.figures.balance > 0 && inPeriod(v.invoice.issue_date) && matches(v.patient, v.invoice.number, query))
    .sort((a, b) => a.invoice.issue_date.localeCompare(b.invoice.issue_date));

  const invoiceStatuses: InvoiceStatus[] = ["draft", "issued", "partially_paid", "paid", "cancelled"];
  const quoteStatuses: QuoteStatus[] = ["draft", "sent", "accepted", "refused", "expired"];

  return (
    <>
      <PageHeader
        title={t("billing.title")}
        subtitle={!canWrite ? <Badge>{t("common.readOnly")}</Badge> : undefined}
        actions={
          canWrite && (
            <>
              <Button variant="secondary" onClick={() => setCreating("quote")}>
                <Plus className="size-4" />
                {t("billing.newQuote")}
              </Button>
              <Button onClick={() => setCreating("invoice")}>
                <Plus className="size-4" />
                {t("billing.newInvoice")}
              </Button>
            </>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("billing.kpi.revenueToday")} value={kpis ? gnf(kpis.day) : "…"} />
        <Kpi label={t("billing.kpi.revenueMonth")} value={kpis ? gnf(kpis.monthRevenue) : "…"} />
        <Kpi label={t("billing.kpi.collectedMonth")} value={kpis ? gnf(kpis.collected) : "…"} tone="success" />
        <Kpi label={t("billing.kpi.unpaid")} value={kpis ? gnf(kpis.unpaid) : "…"} tone={kpis?.unpaid ? "danger" : undefined} />
      </div>
      {kpis?.provisional && <p className="mt-1 text-xs italic text-warning">{t("billing.kpi.provisional")}</p>}

      <div className="mt-4">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "factures", label: t("billing.tabs.invoices") },
            { value: "devis", label: t("billing.tabs.quotes") },
            { value: "impayes", label: `${t("billing.tabs.unpaid")}${data ? ` (${data.invoices.filter((v) => v.figures.balance > 0).length})` : ""}` },
          ]}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input
          className="col-span-2 sm:col-span-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("billing.filters.search")}
          aria-label={t("billing.filters.search")}
        />
        {tab !== "impayes" ? (
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("billing.fields.status")} className="col-span-2 sm:col-span-1">
            <option value="">{t("billing.filters.allStatuses")}</option>
            {(tab === "factures" ? invoiceStatuses : quoteStatuses).map((s) => (
              <option key={s} value={s}>
                {t(tab === "factures" ? `billing.invoiceStatus.${s}` : `billing.quoteStatus.${s}`)}
              </option>
            ))}
          </Select>
        ) : (
          <div className="hidden sm:block" />
        )}
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("billing.filters.from")}
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("billing.filters.to")}
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <Card className="mt-3">
        {!data ? (
          <PageSpinner />
        ) : tab === "factures" ? (
          <InvoiceList views={invoices} />
        ) : tab === "devis" ? (
          <QuoteList views={quotes} />
        ) : (
          <UnpaidList views={unpaid} />
        )}
      </Card>

      <NewDocumentDialog open={creating !== null} onClose={() => setCreating(null)} kind={creating ?? "invoice"} />
    </>
  );
}

function UnpaidList({ views }: { views: InvoiceView[] }) {
  const { t, gnf, date, today, cabinet } = useBilling();
  const collect = useCollectAction();
  if (!views.length) return <EmptyState icon={<Wallet />} title={t("billing.list.emptyUnpaid")} />;
  return (
    <>
      <ul className="divide-y divide-border">
        {views.map((v) => {
          const age = daysBetween(v.invoice.issue_date, today);
          const allocated = allocateInstallments(v.installments, v.figures.paid, today, v.figures.total);
          const late = overdueAmount(allocated);
          const pastDue = !!v.invoice.due_date && v.invoice.due_date < today;
          const name = v.patient ? fullName(v.patient) : "";
          const link = whatsappLink(
            v.patient?.phone,
            t("billing.whatsapp.reminder", {
              name: v.patient?.first_name ?? name,
              number: v.invoice.number ?? "",
              date: date(v.invoice.issue_date),
              amount: gnf(v.figures.balance),
              cabinet: cabinet?.name ?? "",
            }),
          );
          return (
            <li key={v.invoice.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${late > 0 || pastDue ? "bg-danger-soft/60" : ""}`}>
              <Link href={`/app/facturation/facture?id=${v.invoice.id}`} className="min-w-0 flex-1 hover:underline">
                <div className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                  <span className="truncate">{name || "—"}</span>
                  <span className="font-normal text-muted">
                    <DocNumber number={v.invoice.number} status={v.invoice.status} />
                  </span>
                </div>
                <div className="text-xs text-muted">
                  {date(v.invoice.issue_date)} · {t("billing.list.age", { days: age })}
                  {v.patient?.phone ? ` · ${formatPhone(v.patient.phone)}` : ""}
                </div>
                {(late > 0 || pastDue) && (
                  <div className="text-xs font-medium text-danger">
                    {late > 0 ? t("billing.list.overdueAmount", { amount: gnf(late) }) : t("billing.list.pastDue", { date: date(v.invoice.due_date) })}
                  </div>
                )}
              </Link>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <div className="whitespace-nowrap text-sm font-semibold text-danger">{gnf(v.figures.balance)}</div>
                  <div className="whitespace-nowrap text-xs text-muted">
                    {t("billing.fields.total")} {gnf(v.figures.total)}
                  </div>
                </div>
                {link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-2 text-xs font-medium text-success hover:bg-success-soft"
                    title={t("billing.actions.remind")}
                  >
                    <MessageCircle className="size-4" />
                    <span className="hidden sm:inline">{t("billing.actions.remind")}</span>
                  </a>
                ) : (
                  <span className="text-xs text-muted">{t("billing.list.noPhone")}</span>
                )}
                {collect.button(v)}
              </div>
            </li>
          );
        })}
      </ul>
      {collect.dialog}
    </>
  );
}
