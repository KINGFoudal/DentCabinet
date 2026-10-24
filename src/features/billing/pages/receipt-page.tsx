"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Printer } from "lucide-react";
import { localDb } from "@/lib/local/db";
import { formatDateTime, fullName } from "@/lib/format";
import { Button, buttonClass } from "@/components/ui/button";
import { EmptyState, PageSpinner } from "@/components/ui/card";
import { buildInvoiceView, useMemberNames } from "../data";
import { DocNumber, ProvisionalBadge, useBilling } from "../components/common";
import { MetaLine, PatientBlock, PrintSheet, PrintStyles, TotalRow } from "../components/document";

export default function ReceiptPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <ReceiptScreen />
    </Suspense>
  );
}

/** Reçu de paiement imprimable (/app/facturation/recu?id=<paiement>). */
function ReceiptScreen() {
  const id = useSearchParams().get("id");
  const { cabinetId, cabinet, t, gnf, date, locale, tz } = useBilling();
  const names = useMemberNames(cabinetId);

  const data = useLiveQuery(async () => {
    if (!id) return null;
    const db = localDb();
    const payment = await db.payments.get(id);
    if (!payment || payment.cabinet_id !== cabinetId || payment.deleted_at) return null;
    const invoice = await db.invoices.get(payment.invoice_id);
    if (!invoice) return null;
    const [items, payments, patient] = await Promise.all([
      db.invoice_items.where("invoice_id").equals(invoice.id).toArray(),
      db.payments.where("invoice_id").equals(invoice.id).toArray(),
      db.patients.get(invoice.patient_id),
    ]);
    const view = buildInvoiceView(invoice, patient, items, payments, []);
    // Reste à payer juste après ce paiement (paiements réussis jusqu'à celui-ci inclus).
    const upTo = payments
      .filter((p) => !p.deleted_at && p.status === "succeeded" && (p.paid_at < payment.paid_at || (p.paid_at === payment.paid_at && p.id <= payment.id)))
      .reduce((s, p) => s + Number(p.amount_gnf), 0);
    return { payment, view, remainingAfter: Math.max(0, view.figures.total - upTo) };
  }, [id, cabinetId]);

  if (data === undefined) return <PageSpinner />;
  if (!data)
    return (
      <EmptyState
        title={t("billing.notFound")}
        action={
          <Link href="/app/facturation" className={buttonClass("secondary")}>
            {t("common.back")}
          </Link>
        }
      />
    );

  const { payment, view, remainingAfter } = data;
  const receiptNo = `${view.invoice.number ?? t("billing.provisionalNumber")}-R${payment.id.slice(0, 6).toUpperCase()}`;

  return (
    <>
      <PrintStyles />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/app/facturation/facture?id=${view.invoice.id}`} className={buttonClass("ghost", "sm")}>
          <ArrowLeft className="size-4" />
          {t("billing.invoice")} <DocNumber number={view.invoice.number} status={view.invoice.status} />
        </Link>
        <Button size="sm" className="ml-auto" onClick={() => window.print()}>
          <Printer className="size-4" />
          {t("common.print")}
        </Button>
      </div>
      <PrintSheet
        cabinet={cabinet}
        title={t("billing.print.receiptTitle")}
        watermark={payment._dirty === 1 ? t("billing.print.provisionalWatermark") : null}
        meta={
          <>
            <MetaLine label={t("billing.print.receiptNumber")} value={receiptNo} />
            <MetaLine label={t("billing.fields.date")} value={formatDateTime(payment.paid_at, locale, tz)} />
          </>
        }
      >
        <PatientBlock patient={view.patient} />
        <section className="mt-4 rounded-lg border border-border p-4 text-center print-avoid-break">
          <div className="text-xs uppercase text-muted">{t("billing.print.amountReceived")}</div>
          <div className="mt-1 text-2xl font-bold">{gnf(payment.amount_gnf)}</div>
          <div className="mt-1 text-sm">
            {t(`billing.method.${payment.method}`)}
            {payment.reference ? ` · ${t("billing.fields.reference")} ${payment.reference}` : ""}
          </div>
        </section>
        <section className="mt-4 flex flex-col items-end gap-1 text-sm">
          <TotalRow
            label={t("billing.print.forInvoice", { number: view.invoice.number ?? t("billing.provisionalNumber") })}
            value={date(view.invoice.issue_date)}
          />
          <TotalRow label={t("billing.fields.total")} value={gnf(view.figures.total)} />
          <TotalRow label={t("billing.print.remainingAfter")} value={gnf(remainingAfter)} strong />
          <ProvisionalBadge show={view.figures.provisional} />
        </section>
        {payment.received_by && names?.get(payment.received_by) && (
          <p className="mt-4 text-xs">
            {t("billing.fields.receivedBy")} : {names.get(payment.received_by)}
          </p>
        )}
        {view.patient && (
          <p className="mt-1 text-xs">
            {t("billing.print.receivedFrom")} : {fullName(view.patient)}
          </p>
        )}
        <section className="mt-8 grid grid-cols-2 gap-6 text-xs print-avoid-break">
          <div />
          <div className="h-20 rounded-lg border border-dashed border-border p-2 text-muted">{t("billing.print.cashierSignature")}</div>
        </section>
        <footer className="mt-6 border-t border-border pt-3 text-center text-xs text-muted">
          {t("billing.print.thanks")} · {t("billing.print.currencyNote")}
        </footer>
      </PrintSheet>
    </>
  );
}
