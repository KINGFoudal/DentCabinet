"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Ban, CheckCircle2, Pencil, Printer, Receipt, Send, Smartphone, Trash2, Wallet } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageSpinner } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cancelInvoice, cancelPayment, deleteDraft, issueInvoice, updateInvoice } from "../actions";
import { useDentists, useInvoice, useMemberNames, type InvoiceView } from "../data";
import { allocateInstallments } from "../lib/installments";
import { DocNumber, InvoiceStatusBadge, ProvisionalBadge, useBilling } from "../components/common";
import { LinesTable, MetaLine, PatientBlock, PrintSheet, PrintStyles, TotalRow } from "../components/document";
import { LinesEditorDialog } from "../components/lines-editor";
import { PaymentDialog } from "../components/payment-dialog";
import { MobilePaymentDialog } from "../components/mobile-payment-dialog";
import { InstallmentsCard } from "../components/installments-card";

export default function InvoicePage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <InvoiceScreen />
    </Suspense>
  );
}

function InvoiceScreen() {
  const id = useSearchParams().get("id");
  const { cabinetId, t } = useBilling();
  const view = useInvoice(cabinetId, id);
  if (view === undefined) return <PageSpinner />;
  if (!view)
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
  return <InvoiceDetail view={view} />;
}

type Confirm = "issue" | "cancel" | "delete" | { payment: string } | null;

function InvoiceDetail({ view }: { view: InvoiceView }) {
  const { t, gnf, date, canWrite, cabinet, cabinetId, today, locale, tz } = useBilling();
  const router = useRouter();
  const toast = useToast();
  const dentists = useDentists(cabinetId);
  const names = useMemberNames(cabinetId);
  const [editLines, setEditLines] = useState(false);
  const [pay, setPay] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const { invoice, figures, patient } = view;
  const status = figures.status;
  const isDraft = status === "draft";
  const open = status === "issued" || status === "partially_paid";
  const payments = view.payments.filter((p) => !p.deleted_at);
  const succeeded = payments.filter((p) => p.status === "succeeded");
  const dentist = dentists?.find((d) => d.id === invoice.dentist_id);
  const overdue = allocateInstallments(view.installments, figures.paid, today, figures.total).some((i) => i.state === "overdue");
  const pastDue = open && !!invoice.due_date && invoice.due_date < today;
  const liveItems = view.items.filter((i) => !i.deleted_at);

  const watermark = isDraft
    ? t("billing.print.draftWatermark")
    : status === "cancelled"
      ? t("billing.print.cancelledWatermark")
      : figures.numberPending
        ? t("billing.print.provisionalWatermark")
        : null;

  return (
    <>
      <PrintStyles />
      <div className="no-print mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/app/facturation" className={buttonClass("ghost", "sm")}>
            <ArrowLeft className="size-4" />
            {t("billing.title")}
          </Link>
          <h1 className="text-lg font-semibold sm:text-xl">
            {t("billing.invoice")} <DocNumber number={invoice.number} status={invoice.status} />
          </h1>
          <InvoiceStatusBadge status={status} />
          <ProvisionalBadge show={figures.provisional} />
          {(overdue || pastDue) && <span className="text-xs font-medium text-danger">{t("billing.list.overdue")}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && isDraft && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setEditLines(true)}>
                <Pencil className="size-4" />
                {t("billing.actions.editLines")}
              </Button>
              <Button size="sm" onClick={() => (liveItems.length ? setConfirm("issue") : toast(t("billing.confirm.issueEmpty"), "error"))}>
                <Send className="size-4" />
                {t("billing.actions.issue")}
              </Button>
            </>
          )}
          {canWrite && open && figures.balance > 0 && (
            <>
              <Button size="sm" onClick={() => setPay(true)}>
                <Wallet className="size-4" />
                {t("billing.actions.recordPayment")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setMobile(true)}>
                <Smartphone className="size-4" />
                {t("billing.actions.requestMobile")}
              </Button>
            </>
          )}
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" />
            {t("common.print")}
          </Button>
          {canWrite && open && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => (succeeded.length ? toast(t("billing.confirm.cancelWithPayments"), "error") : setConfirm("cancel"))}
            >
              <Ban className="size-4 text-danger" />
              {t("billing.actions.cancelInvoice")}
            </Button>
          )}
          {canWrite && isDraft && (
            <Button size="sm" variant="ghost" onClick={() => setConfirm("delete")}>
              <Trash2 className="size-4 text-danger" />
              {t("billing.actions.deleteDraft")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] print:block">
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

        <div className="no-print flex flex-col gap-4">
          <Card>
            <CardHeader title={t("billing.payment.list")} />
            <CardBody className="p-0">
              {payments.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted">{t("billing.payment.none")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {gnf(p.amount_gnf)} <ProvisionalBadge show={p._dirty === 1} />
                        </div>
                        <div className="truncate text-xs text-muted">
                          {formatDateTime(p.paid_at, locale, tz)} · {t(`billing.method.${p.method}`)}
                          {p.reference ? ` · ${p.reference}` : ""}
                          {p.status !== "succeeded" ? ` · ${t(`billing.paymentStatus.${p.status}`)}` : ""}
                          {p.received_by && names?.get(p.received_by) ? ` · ${names.get(p.received_by)}` : ""}
                        </div>
                      </div>
                      {p.status === "succeeded" && (
                        <Link href={`/app/facturation/recu?id=${p.id}`} className={buttonClass("ghost", "sm")} aria-label={t("billing.actions.receipt")}>
                          <Receipt className="size-4" />
                        </Link>
                      )}
                      {canWrite && !p.transaction_id && status !== "cancelled" && (
                        <Button size="sm" variant="ghost" aria-label={t("billing.actions.cancelPayment")} onClick={() => setConfirm({ payment: p.id })}>
                          <Ban className="size-4 text-danger" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {!isDraft && status !== "cancelled" && <InstallmentsCard view={view} editable={canWrite && open} />}

          <Card>
            <CardHeader title={t("billing.details")} />
            <CardBody className="flex flex-col gap-3">
              <DetailsForm key={invoice.id} view={view} dentists={dentists ?? []} editable={canWrite && status !== "cancelled"} />
              {invoice.quote_id && (
                <Link href={`/app/facturation/devis?id=${invoice.quote_id}`} className="text-sm text-primary underline">
                  {t("billing.actions.viewQuote")}
                </Link>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <LinesEditorDialog open={editLines} onClose={() => setEditLines(false)} kind="invoice" parentId={invoice.id} items={view.items} />
      <PaymentDialog open={pay} onClose={() => setPay(false)} invoiceId={invoice.id} balance={figures.balance} />
      <MobilePaymentDialog
        open={mobile}
        onClose={() => setMobile(false)}
        invoiceId={invoice.id}
        balance={figures.balance}
        defaultPhone={patient?.phone ?? null}
      />
      <ConfirmDialog
        open={confirm === "issue"}
        onClose={() => setConfirm(null)}
        title={t("billing.confirm.issueTitle")}
        message={t("billing.confirm.issueMessage", { total: gnf(figures.total) })}
        confirmLabel={t("billing.actions.issue")}
        cancelLabel={t("common.cancel")}
        onConfirm={async () => {
          await issueInvoice(invoice.id, today);
          toast(t("billing.confirm.issued"));
        }}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        onClose={() => setConfirm(null)}
        danger
        title={t("billing.confirm.cancelTitle")}
        message={t("billing.confirm.cancelMessage")}
        confirmLabel={t("billing.actions.cancelInvoice")}
        cancelLabel={t("common.back")}
        onConfirm={() => void cancelInvoice(invoice.id)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        danger
        title={t("billing.confirm.deleteTitle")}
        message={t("billing.confirm.deleteMessage")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={async () => {
          await deleteDraft("invoice", invoice.id);
          router.push("/app/facturation");
        }}
      />
      <ConfirmDialog
        open={typeof confirm === "object" && confirm !== null}
        onClose={() => setConfirm(null)}
        danger
        title={t("billing.confirm.cancelPaymentTitle")}
        message={t("billing.confirm.cancelPaymentMessage")}
        confirmLabel={t("billing.actions.cancelPayment")}
        cancelLabel={t("common.back")}
        onConfirm={async () => {
          if (typeof confirm === "object" && confirm) await cancelPayment(confirm.payment);
        }}
      />
      {status === "paid" && (
        <p className="no-print mt-4 flex items-center justify-center gap-1 text-sm text-success">
          <CheckCircle2 className="size-4" />
          {t("billing.paidInFull")}
        </p>
      )}
    </>
  );
}

function DetailsForm({ view, dentists, editable }: { view: InvoiceView; dentists: { id: string; name: string }[]; editable: boolean }) {
  const { t } = useBilling();
  const toast = useToast();
  const { invoice } = view;
  const [due, setDue] = useState(invoice.due_date ?? "");
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [dentist, setDentist] = useState(invoice.dentist_id ?? "");
  const dirty = due !== (invoice.due_date ?? "") || notes !== (invoice.notes ?? "") || dentist !== (invoice.dentist_id ?? "");

  return (
    <>
      <Field label={t("billing.fields.dueDate")}>
        {(p) => <Input {...p} type="date" value={due} disabled={!editable} onChange={(e) => setDue(e.target.value)} />}
      </Field>
      {dentists.length > 0 && (
        <Field label={t("billing.fields.dentist")}>
          {(p) => (
            <Select {...p} value={dentist} disabled={!editable} onChange={(e) => setDentist(e.target.value)}>
              <option value="">—</option>
              {dentists.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label={t("billing.fields.notes")} hint={t("billing.notesHint")}>
        {(p) => <Textarea {...p} className="min-h-16" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
      {editable && dirty && (
        <Button
          size="sm"
          onClick={async () => {
            await updateInvoice(invoice.id, { due_date: due || null, notes: notes.trim() || null, dentist_id: dentist || null });
            toast(t("common.saved"));
          }}
        >
          {t("common.save")}
        </Button>
      )}
    </>
  );
}
