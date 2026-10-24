"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarPlus, ChevronDown, ChevronUp, FileText, Printer } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, EmptyState } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatGNF, formatTime } from "@/lib/format";
import { errorKey } from "@/features/portal/lib/errors";
import { canCancelOnline, doctorLabel, longDate, splitAppointments } from "@/features/portal/lib/schedule";
import {
  activeLines,
  balance,
  type PortalAppointment,
  type PortalData,
  type PortalDocument,
  type PortalInvoice,
  type PortalLine,
  type PortalQuote,
} from "@/features/portal/lib/portal-data";
import type { PortalCabinet } from "@/features/portal/lib/types";

const APPT_TONE: Record<string, Tone> = {
  scheduled: "info",
  confirmed: "success",
  arrived: "primary",
  in_treatment: "primary",
  done: "neutral",
  cancelled: "danger",
  no_show: "warning",
};
const INVOICE_TONE: Record<string, Tone> = { issued: "warning", partially_paid: "warning", paid: "success", cancelled: "neutral" };
const QUOTE_TONE: Record<string, Tone> = { sent: "info", accepted: "success", refused: "neutral", expired: "neutral" };

type Lookup = { cabinet: (id: string) => PortalCabinet | undefined; showCabinet: boolean };

function CabinetLine({ cabinet, show }: { cabinet: PortalCabinet | undefined; show: boolean }) {
  if (!show || !cabinet) return null;
  return <p className="text-xs text-muted">{cabinet.name}</p>;
}

// ---------------------------------------------------------------------------
// Rendez-vous
// ---------------------------------------------------------------------------

export function AppointmentsSection({ data, lookup, onChanged }: { data: PortalData; lookup: Lookup; onChanged: () => void }) {
  const { t } = useI18n();
  const { upcoming, past } = splitAppointments(data.appointments);
  const bookable = data.cabinets.filter((c) => c.online_booking_enabled);

  return (
    <div className="flex flex-col gap-5">
      {bookable.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {bookable.map((c) => (
            <Link key={c.id} href={`/c/${c.slug}/rdv`} className={buttonClass("primary")}>
              <CalendarPlus className="size-4" />
              {t("portal.appointments.bookNew")}
              {bookable.length > 1 && <span className="font-normal">· {c.name}</span>}
            </Link>
          ))}
        </div>
      )}
      <section>
        <h2 className="mb-2 font-semibold">{t("portal.appointments.upcoming")}</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">{t("portal.appointments.noUpcoming")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((a) => (
              <AppointmentCard key={a.id} appt={a} lookup={lookup} upcoming onChanged={onChanged} />
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-2 font-semibold">{t("portal.appointments.history")}</h2>
        {past.length === 0 ? (
          <p className="text-sm text-muted">{t("portal.appointments.noHistory")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {past.map((a) => (
              <AppointmentCard key={a.id} appt={a} lookup={lookup} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AppointmentCard({
  appt,
  lookup,
  upcoming,
  onChanged,
}: {
  appt: PortalAppointment;
  lookup: Lookup;
  upcoming?: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const cabinet = lookup.cabinet(appt.cabinet_id);
  const tz = cabinet?.timezone ?? "Africa/Conakry";
  const type = cabinet?.appointment_types.find((x) => x.id === appt.type_id);
  const dentist = cabinet?.dentists.find((d) => d.id === appt.dentist_id)?.name;
  const minHours = cabinet?.online_cancel_min_hours ?? 24;
  const cancellable = upcoming && canCancelOnline(appt, minHours);

  async function cancel() {
    setBusy(true);
    const { error } = await supabase().rpc("cancel_online", { p_appointment: appt.id });
    setBusy(false);
    if (error) {
      toast(t(errorKey(error)), "error");
      return;
    }
    toast(t("portal.appointments.cancelled"));
    onChanged();
  }

  return (
    <li>
      <Card>
        <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium first-letter:uppercase">
              {longDate(appt.starts_at, locale, tz)} · {formatTime(appt.starts_at, locale, tz)}
            </p>
            <p className="text-sm">
              {type?.name ?? appt.title ?? ""}
              {dentist && <span className="text-muted"> · {doctorLabel(dentist, t)}</span>}
            </p>
            <CabinetLine cabinet={cabinet} show={lookup.showCabinet} />
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone={APPT_TONE[appt.status] ?? "neutral"}>{t(`portal.appointments.status.${appt.status}`)}</Badge>
              {appt.source === "online" && <Badge>{t("portal.appointments.online")}</Badge>}
            </div>
          </div>
          {upcoming &&
            (cancellable ? (
              <Button variant="secondary" size="sm" loading={busy} onClick={() => setConfirming(true)} className="self-start sm:self-center">
                {t("portal.appointments.cancel")}
              </Button>
            ) : (
              appt.status !== "arrived" &&
              appt.status !== "in_treatment" && (
                <p className="text-xs text-muted sm:max-w-48 sm:text-right">{t("portal.appointments.cancelRule", { hours: minHours })}</p>
              )
            ))}
        </CardBody>
      </Card>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={cancel}
        title={t("portal.appointments.cancelTitle")}
        message={t("portal.appointments.cancelConfirm", {
          date: formatDate(appt.starts_at, locale, tz),
          time: formatTime(appt.starts_at, locale, tz),
        })}
        confirmLabel={t("portal.appointments.cancelYes")}
        cancelLabel={t("portal.appointments.keep")}
        danger
      />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Factures et devis
// ---------------------------------------------------------------------------

function Lines({ lines }: { lines: PortalLine[] }) {
  const { t, locale } = useI18n();
  return (
    <ul className="divide-y divide-border text-sm">
      {activeLines(lines).map((l) => (
        <li key={l.id} className="flex justify-between gap-3 py-1.5">
          <span className="min-w-0">
            {l.label}
            {l.tooth ? <span className="text-muted"> ({t("portal.billing.tooth", { tooth: l.tooth })})</span> : null}
            {l.quantity > 1 && <span className="text-muted"> × {l.quantity}</span>}
          </span>
          <span className="shrink-0">{formatGNF(l.quantity * Number(l.unit_price_gnf), locale)}</span>
        </li>
      ))}
    </ul>
  );
}

export function BillingSection({ data, lookup, onPay }: { data: PortalData; lookup: Lookup; onPay: (inv: PortalInvoice) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="mb-2 font-semibold">{t("portal.billing.invoices")}</h2>
        {data.invoices.length === 0 ? (
          <p className="text-sm text-muted">{t("portal.billing.noInvoices")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.invoices.map((inv) => (
              <InvoiceCard key={inv.id} invoice={inv} lookup={lookup} onPay={onPay} />
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-2 font-semibold">{t("portal.billing.quotes")}</h2>
        {data.quotes.length === 0 ? (
          <p className="text-sm text-muted">{t("portal.billing.noQuotes")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.quotes.map((q) => (
              <QuoteCard key={q.id} quote={q} lookup={lookup} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function InvoiceCard({ invoice, lookup, onPay }: { invoice: PortalInvoice; lookup: Lookup; onPay: (inv: PortalInvoice) => void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const cabinet = lookup.cabinet(invoice.cabinet_id);
  const tz = cabinet?.timezone;
  const due = balance(invoice);
  const payments = invoice.payments.filter((p) => !p.deleted_at && p.status === "succeeded");
  return (
    <li>
      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className="whitespace-nowrap font-medium">{t("portal.billing.invoice", { number: invoice.number ?? "—" })}</p>
              <p className="text-xs text-muted">{t("portal.billing.issued", { date: formatDate(invoice.issue_date, locale, "UTC") })}</p>
              <CabinetLine cabinet={cabinet} show={lookup.showCabinet} />
            </div>
            <Badge tone={INVOICE_TONE[invoice.status] ?? "neutral"}>{t(`portal.billing.invoiceStatus.${invoice.status}`)}</Badge>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted">{t("portal.billing.total")}</dt>
              <dd className="font-medium">{formatGNF(invoice.total_gnf, locale)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t("portal.billing.paid")}</dt>
              <dd>{formatGNF(invoice.paid_gnf, locale)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t("portal.billing.balance")}</dt>
              <dd className={due > 0 ? "font-semibold text-danger" : "font-medium"}>{formatGNF(due, locale)}</dd>
            </div>
          </dl>
          {due > 0 && invoice.due_date && (
            <p className="text-xs text-muted">{t("portal.billing.due", { date: formatDate(invoice.due_date, locale, "UTC") })}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {due > 0 && (invoice.status === "issued" || invoice.status === "partially_paid") && (
              <Button onClick={() => onPay(invoice)}>{t("portal.billing.pay")}</Button>
            )}
            <button type="button" className="flex items-center gap-1 text-sm text-primary hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              {t(open ? "portal.billing.hideDetails" : "portal.billing.details")}
            </button>
          </div>
          {open && (
            <div className="flex flex-col gap-3 border-t border-border pt-3">
              <Lines lines={invoice.invoice_items} />
              {payments.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase text-muted">{t("portal.billing.payments")}</p>
                  <ul className="text-sm">
                    {payments.map((p) => (
                      <li key={p.id} className="flex justify-between gap-3 py-0.5">
                        <span>
                          {formatDate(p.paid_at, locale, tz)} · {t(`portal.billing.method.${p.method}`)}
                        </span>
                        <span>{formatGNF(p.amount_gnf, locale)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </li>
  );
}

function QuoteCard({ quote, lookup }: { quote: PortalQuote; lookup: Lookup }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const cabinet = lookup.cabinet(quote.cabinet_id);
  return (
    <li>
      <Card>
        <CardBody className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className="whitespace-nowrap font-medium">{t("portal.billing.quote", { number: quote.number ?? "—" })}</p>
              <p className="text-xs text-muted">
                {t("portal.billing.issued", { date: formatDate(quote.issue_date, locale, "UTC") })}
                {quote.valid_until && <> · {t("portal.billing.validUntil", { date: formatDate(quote.valid_until, locale, "UTC") })}</>}
              </p>
              <CabinetLine cabinet={cabinet} show={lookup.showCabinet} />
            </div>
            <Badge tone={QUOTE_TONE[quote.status] ?? "neutral"}>{t(`portal.billing.quoteStatus.${quote.status}`)}</Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="flex items-center gap-1 text-sm text-primary hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              {t(open ? "portal.billing.hideDetails" : "portal.billing.details")}
            </button>
            <p className="font-medium">{formatGNF(quote.total_gnf, locale)}</p>
          </div>
          {open && (
            <div className="border-t border-border pt-2">
              <Lines lines={quote.quote_items} />
              {quote.notes && <p className="mt-2 whitespace-pre-line text-sm text-muted">{quote.notes}</p>}
            </div>
          )}
        </CardBody>
      </Card>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Ordonnances et documents
// ---------------------------------------------------------------------------

export function PrescriptionsSection({ data, lookup }: { data: PortalData; lookup: Lookup }) {
  const { t, locale } = useI18n();
  if (data.prescriptions.length === 0) return <EmptyState icon={<FileText />} title={t("portal.prescriptions.none")} />;
  return (
    <ul className="flex flex-col gap-2">
      {data.prescriptions.map((p) => {
        const cabinet = lookup.cabinet(p.cabinet_id);
        const dentist = cabinet?.dentists.find((d) => d.id === p.dentist_id)?.name;
        return (
          <li key={p.id}>
            <Card>
              <CardBody className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {t("portal.prescriptions.title")} · {formatDate(p.issued_at, locale, cabinet?.timezone)}
                    </p>
                    {dentist && <p className="text-sm text-muted">{doctorLabel(dentist, t)}</p>}
                    <CabinetLine cabinet={cabinet} show={lookup.showCabinet} />
                  </div>
                  <Link href={`/patient/ordonnance?id=${p.id}`} className={buttonClass("secondary", "sm", "shrink-0")}>
                    <Printer className="size-4" />
                    {t("portal.prescriptions.print")}
                  </Link>
                </div>
                <ul className="list-disc pl-5 text-sm">
                  {p.items.map((it, i) => (
                    <li key={i}>
                      <span className="font-medium">{it.drug}</span>
                      {it.dosage && <span className="text-muted"> — {it.dosage}</span>}
                      {it.duration && <span className="text-muted">, {it.duration}</span>}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** Ouvre un document via une URL signée courte (60 s) du bucket privé « documents ». */
async function openDocument(doc: PortalDocument): Promise<boolean> {
  // Fenêtre ouverte tout de suite (sinon bloquée par le navigateur après l'attente réseau).
  const win = window.open("", "_blank");
  const { data, error } = await supabase().storage.from("documents").createSignedUrl(doc.storage_path, 60);
  if (error || !data?.signedUrl) {
    win?.close();
    return false;
  }
  if (win) {
    win.opener = null;
    win.location.href = data.signedUrl;
  } else {
    window.location.assign(data.signedUrl);
  }
  return true;
}

export function DocumentsSection({ data, lookup }: { data: PortalData; lookup: Lookup }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (data.documents.length === 0) return <EmptyState icon={<FileText />} title={t("portal.documents.none")} />;
  return (
    <ul className="flex flex-col gap-2">
      {data.documents.map((d) => {
        const cabinet = lookup.cabinet(d.cabinet_id);
        return (
          <li key={d.id}>
            <Card>
              <CardBody className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{d.title}</p>
                  <p className="text-xs text-muted">
                    {t(`portal.documents.kind.${d.kind}`)} · {formatDate(d.created_at, locale, cabinet?.timezone)}
                    {d.size_bytes ? ` · ${Math.max(1, Math.round(Number(d.size_bytes) / 1024))} ${locale === "fr" ? "Ko" : "KB"}` : ""}
                  </p>
                  <CabinetLine cabinet={cabinet} show={lookup.showCabinet} />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy === d.id}
                  onClick={async () => {
                    setBusy(d.id);
                    const ok = await openDocument(d);
                    setBusy(null);
                    if (!ok) toast(t("portal.documents.openFailed"), "error");
                  }}
                >
                  {t("portal.documents.open")}
                </Button>
              </CardBody>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
