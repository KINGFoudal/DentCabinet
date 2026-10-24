"use client";

import Link from "next/link";
import { FileText, Receipt } from "lucide-react";
import { fullName } from "@/lib/format";
import { EmptyState } from "@/components/ui/card";
import type { InvoiceView, QuoteView } from "../data";
import { displayQuoteStatus } from "../lib/totals";
import { DocNumber, InvoiceStatusBadge, ProvisionalBadge, QuoteStatusBadge, useBilling } from "./common";

export function InvoiceList({ views, compact }: { views: InvoiceView[]; compact?: boolean }) {
  const { t, gnf, date } = useBilling();
  if (!views.length) return <EmptyState icon={<Receipt />} title={t("billing.list.emptyInvoices")} />;
  return (
    <ul className="divide-y divide-border">
      {views.map((v) => (
        <li key={v.invoice.id}>
          <Link href={`/app/facturation/facture?id=${v.invoice.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-primary-soft">
            <div className="min-w-0 flex-1">
              <div className="whitespace-nowrap text-sm font-medium">
                <DocNumber number={v.invoice.number} status={v.invoice.status} />
              </div>
              {!compact && <div className="truncate text-sm">{v.patient ? fullName(v.patient) : "—"}</div>}
              <div className="text-xs text-muted">{date(v.invoice.issue_date)}</div>
            </div>
            <div className="flex flex-col items-end gap-1 text-right">
              <div className="whitespace-nowrap text-sm font-semibold">
                {gnf(v.figures.total)} <ProvisionalBadge show={v.figures.provisional} />
              </div>
              {v.figures.balance > 0 && v.figures.paid > 0 && (
                <span className="whitespace-nowrap text-xs text-danger">
                  {t("billing.fields.balance")} {gnf(v.figures.balance)}
                </span>
              )}
              <InvoiceStatusBadge status={v.figures.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function QuoteList({ views, compact }: { views: QuoteView[]; compact?: boolean }) {
  const { t, gnf, date, today } = useBilling();
  if (!views.length) return <EmptyState icon={<FileText />} title={t("billing.list.emptyQuotes")} />;
  return (
    <ul className="divide-y divide-border">
      {views.map((v) => (
        <li key={v.quote.id}>
          <Link href={`/app/facturation/devis?id=${v.quote.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-primary-soft">
            <div className="min-w-0 flex-1">
              <div className="whitespace-nowrap text-sm font-medium">
                <DocNumber number={v.quote.number} status={v.quote.status} />
              </div>
              {!compact && <div className="truncate text-sm">{v.patient ? fullName(v.patient) : "—"}</div>}
              <div className="text-xs text-muted">
                {date(v.quote.issue_date)}
                {v.quote.valid_until ? ` · ${t("billing.fields.validUntil")} ${date(v.quote.valid_until)}` : ""}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="whitespace-nowrap text-sm font-semibold">
                {gnf(v.figures.total)} <ProvisionalBadge show={v.figures.provisional} />
              </div>
              <QuoteStatusBadge status={displayQuoteStatus(v.quote, today)} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
