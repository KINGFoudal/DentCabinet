"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, FileText, Pencil, Printer, Send, Trash2, Undo2, X } from "lucide-react";
import type { Enums } from "@/lib/database.types";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageSpinner } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createInvoice, deleteDraft, setQuoteStatus, updateQuote } from "../actions";
import { useDentists, useQuote, type Invoice, type QuoteView } from "../data";
import { canConvertQuote, quoteToInvoiceLines } from "../lib/convert";
import { displayQuoteStatus } from "../lib/totals";
import { DocNumber, ProvisionalBadge, QuoteStatusBadge, useBilling } from "../components/common";
import { LinesTable, MetaLine, PatientBlock, PrintSheet, PrintStyles } from "../components/document";
import { LinesEditorDialog } from "../components/lines-editor";

export default function QuotePage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <QuoteScreen />
    </Suspense>
  );
}

function QuoteScreen() {
  const id = useSearchParams().get("id");
  const { cabinetId, t } = useBilling();
  const view = useQuote(cabinetId, id);
  if (view === undefined) return <PageSpinner />;
  if (!view)
    return (
      <EmptyState
        title={t("billing.notFound")}
        action={
          <Link href="/app/facturation?onglet=devis" className={buttonClass("secondary")}>
            {t("common.back")}
          </Link>
        }
      />
    );
  return <QuoteDetail view={view} />;
}

function QuoteDetail({ view }: { view: QuoteView & { invoice: Invoice | null } }) {
  const { t, date, canWrite, cabinet, cabinetId, today, userId } = useBilling();
  const router = useRouter();
  const toast = useToast();
  const dentists = useDentists(cabinetId);
  const [editLines, setEditLines] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [converting, setConverting] = useState(false);

  const { quote, figures, patient, invoice } = view;
  const status = displayQuoteStatus(quote, today);
  const dentist = dentists?.find((d) => d.id === quote.dentist_id);
  const liveItems = view.items.filter((i) => !i.deleted_at);

  const setStatus = async (s: Enums<"quote_status">) => {
    if (s === "sent" && liveItems.length === 0) return toast(t("billing.confirm.issueEmpty"), "error");
    await setQuoteStatus(quote.id, s, today);
    toast(t("common.saved"));
  };

  async function convert() {
    setConverting(true);
    try {
      const id = await createInvoice({
        cabinetId,
        patientId: quote.patient_id,
        userId,
        today,
        dentistId: quote.dentist_id,
        quoteId: quote.id,
        lines: quoteToInvoiceLines(view.items),
      });
      router.push(`/app/facturation/facture?id=${id}`);
    } finally {
      setConverting(false);
    }
  }

  const watermark = quote.status === "draft" ? t("billing.print.draftWatermark") : figures.numberPending ? t("billing.print.provisionalWatermark") : null;

  return (
    <>
      <PrintStyles />
      <div className="no-print mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/app/facturation?onglet=devis" className={buttonClass("ghost", "sm")}>
            <ArrowLeft className="size-4" />
            {t("billing.title")}
          </Link>
          <h1 className="text-lg font-semibold sm:text-xl">
            {t("billing.quote")} <DocNumber number={quote.number} status={quote.status} />
          </h1>
          <QuoteStatusBadge status={status} />
          <ProvisionalBadge show={figures.provisional} />
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && quote.status === "draft" && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setEditLines(true)}>
                <Pencil className="size-4" />
                {t("billing.actions.editLines")}
              </Button>
              <Button size="sm" onClick={() => setStatus("sent")}>
                <Send className="size-4" />
                {t("billing.actions.markSent")}
              </Button>
            </>
          )}
          {canWrite && (quote.status === "sent" || quote.status === "expired") && (
            <>
              <Button size="sm" onClick={() => setStatus("accepted")}>
                <Check className="size-4" />
                {t("billing.actions.markAccepted")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setStatus("refused")}>
                <X className="size-4" />
                {t("billing.actions.markRefused")}
              </Button>
              {quote.status === "sent" && (
                <Button size="sm" variant="ghost" onClick={() => setStatus("expired")}>
                  {t("billing.actions.markExpired")}
                </Button>
              )}
            </>
          )}
          {canWrite && (quote.status === "accepted" || quote.status === "refused") && !invoice && (
            <Button size="sm" variant="ghost" onClick={() => setStatus("sent")}>
              <Undo2 className="size-4" />
              {t("billing.actions.backToSent")}
            </Button>
          )}
          {canConvertQuote(quote) &&
            (invoice ? (
              <Link href={`/app/facturation/facture?id=${invoice.id}`} className={buttonClass("secondary", "sm")}>
                <FileText className="size-4" />
                {t("billing.actions.viewInvoice")}
              </Link>
            ) : (
              canWrite && (
                <Button size="sm" onClick={convert} loading={converting}>
                  <FileText className="size-4" />
                  {t("billing.actions.convert")}
                </Button>
              )
            ))}
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" />
            {t("common.print")}
          </Button>
          {canWrite && quote.status === "draft" && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4 text-danger" />
              {t("billing.actions.deleteDraft")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] print:block">
        <PrintSheet
          cabinet={cabinet}
          title={t("billing.print.quoteTitle")}
          watermark={watermark}
          meta={
            <>
              <MetaLine label={t("billing.fields.number")} value={<DocNumber number={quote.number} status={quote.status} />} />
              <MetaLine label={t("billing.fields.issueDate")} value={date(quote.issue_date)} />
              {quote.valid_until && <MetaLine label={t("billing.fields.validUntil")} value={date(quote.valid_until)} />}
              {dentist && <MetaLine label={t("billing.fields.dentist")} value={dentist.name} />}
            </>
          }
        >
          <PatientBlock patient={patient} />
          <LinesTable lines={view.items} total={figures.total} provisional={figures.provisional} />
          {quote.notes && <p className="mt-4 whitespace-pre-line text-xs">{quote.notes}</p>}
          <section className="mt-6 space-y-1 text-xs print-avoid-break">
            {quote.valid_until && <p>{t("billing.print.validity", { date: date(quote.valid_until) })}</p>}
            <p>{t("billing.print.quoteMention")}</p>
            <p>{t("billing.print.currencyNote")}</p>
          </section>
          <section className="mt-6 grid grid-cols-1 gap-6 text-xs sm:grid-cols-2 print-avoid-break">
            <div className="h-24 rounded-lg border border-dashed border-border p-2 text-muted">{t("billing.print.practitionerSignature")}</div>
            <div className="h-24 rounded-lg border border-dashed border-border p-2 text-muted">{t("billing.print.agreement")}</div>
          </section>
        </PrintSheet>

        <div className="no-print">
          <Card>
            <CardHeader title={t("billing.details")} />
            <CardBody className="flex flex-col gap-3">
              <QuoteDetailsForm key={quote.id} view={view} editable={canWrite && (quote.status === "draft" || quote.status === "sent")} />
              {quote.accepted_at && (
                <p className="text-xs text-muted">
                  {t("billing.acceptedOn")} {date(quote.accepted_at)}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <LinesEditorDialog open={editLines} onClose={() => setEditLines(false)} kind="quote" parentId={quote.id} items={view.items} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title={t("billing.confirm.deleteTitle")}
        message={t("billing.confirm.deleteMessage")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={async () => {
          await deleteDraft("quote", quote.id);
          router.push("/app/facturation?onglet=devis");
        }}
      />
    </>
  );
}

function QuoteDetailsForm({ view, editable }: { view: QuoteView; editable: boolean }) {
  const { t } = useBilling();
  const toast = useToast();
  const { quote } = view;
  const [validUntil, setValidUntil] = useState(quote.valid_until ?? "");
  const [notes, setNotes] = useState(quote.notes ?? "");
  const dirty = validUntil !== (quote.valid_until ?? "") || notes !== (quote.notes ?? "");
  return (
    <>
      <Field label={t("billing.fields.validUntil")}>
        {(p) => <Input {...p} type="date" value={validUntil} disabled={!editable} onChange={(e) => setValidUntil(e.target.value)} />}
      </Field>
      <Field label={t("billing.fields.notes")} hint={t("billing.notesHint")}>
        {(p) => <Textarea {...p} className="min-h-16" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
      {editable && dirty && (
        <Button
          size="sm"
          onClick={async () => {
            await updateQuote(quote.id, { valid_until: validUntil || null, notes: notes.trim() || null });
            toast(t("common.saved"));
          }}
        >
          {t("common.save")}
        </Button>
      )}
    </>
  );
}
