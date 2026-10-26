"use client";

import { useDentists, type InvoiceView } from "../data";
import { DocNumber, useBilling } from "./common";
import { LinesTable, MetaLine, PatientBlock, PrintSheet, TotalRow } from "./document";

/** Feuille imprimable d'une facture (page facture, documents de consultation). */
export function InvoiceSheet({ view }: { view: InvoiceView }) {
  const { t, gnf, date, cabinet, cabinetId } = useBilling();
  const dentists = useDentists(cabinetId);
  const { invoice, figures, patient } = view;
  const status = figures.status;
  const isDraft = status === "draft";
  const succeeded = view.payments.filter((p) => !p.deleted_at && p.status === "succeeded");
  const dentist = dentists?.find((d) => d.id === invoice.dentist_id);

  const watermark = isDraft
    ? t("billing.print.draftWatermark")
    : status === "cancelled"
      ? t("billing.print.cancelledWatermark")
      : figures.numberPending
        ? t("billing.print.provisionalWatermark")
        : null;

  return (
    <PrintSheet
      cabinet={cabinet}
      title={t("billing.print.invoiceTitle")}
      watermark={watermark}
      meta={
        <>
          <MetaLine label={t("billing.fields.number")} value={<DocNumber number={invoice.number} status={invoice.status} />} />
          <MetaLine label={t("billing.fields.issueDate")} value={date(invoice.issue_date)} />
          {invoice.due_date && <MetaLine label={t("billing.fields.dueDate")} value={date(invoice.due_date)} />}
          {dentist && <MetaLine label={t("billing.fields.dentist")} value={dentist.name} />}
        </>
      }
    >
      <PatientBlock patient={patient} />
      <LinesTable
        lines={view.items}
        total={figures.total}
        provisional={figures.provisional}
        footer={
          !isDraft && (
            <>
              <TotalRow label={t("billing.fields.paid")} value={gnf(figures.paid)} tone={figures.paid > 0 ? "success" : undefined} />
              <TotalRow label={t("billing.fields.balance")} value={gnf(figures.balance)} strong tone={figures.balance > 0 ? "danger" : undefined} />
            </>
          )
        }
      />
      {succeeded.length > 0 && (
        <section className="mt-4 print-avoid-break">
          <h3 className="mb-1 text-xs font-medium uppercase text-muted">{t("billing.payment.list")}</h3>
          <ul className="text-xs">
            {succeeded.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 border-b border-border py-1">
                <span>
                  {date(p.paid_at)} · {t(`billing.method.${p.method}`)}
                  {p.reference ? ` · ${p.reference}` : ""}
                </span>
                <span>{gnf(p.amount_gnf)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.installments.length > 0 && (
        <section className="mt-4 print-avoid-break">
          <h3 className="mb-1 text-xs font-medium uppercase text-muted">{t("billing.installments.title")}</h3>
          <ul className="text-xs">
            {view.installments
              .slice()
              .sort((a, b) => a.due_date.localeCompare(b.due_date))
              .map((i) => (
                <li key={i.id} className="flex justify-between gap-2 border-b border-border py-1">
                  <span>{date(i.due_date)}</span>
                  <span>{gnf(i.amount_gnf)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
      {invoice.notes && <p className="mt-4 whitespace-pre-line text-xs">{invoice.notes}</p>}
      <footer className="mt-6 border-t border-border pt-3 text-center text-xs text-muted">{t("billing.print.currencyNote")}</footer>
    </PrintSheet>
  );
}
