"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { localDb, type Row } from "@/lib/local/db";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { fullName } from "@/lib/format";
import { todayISO } from "@/lib/dates";
import {
  appointmentVars,
  baseVars,
  invoiceVars,
  MESSAGE_CONTEXTS,
  type PatientMessageKind,
} from "../../../../supabase/functions/_shared/patient-messages";
import { WhatsAppButton, type ComposerOption } from "./whatsapp-composer";

type ButtonLook = { label?: string; variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md"; className?: string };

/** Nom affiché du praticien (même règle que l'agenda : nom dans le cabinet, sinon profil). */
async function dentistName(cabinetId: string, userId: string) {
  const db = localDb();
  const m = await db.memberships.where("cabinet_id").equals(cabinetId).filter((x) => x.user_id === userId).first();
  if (m?.display_name) return m.display_name;
  return (await db.profiles.get(userId))?.full_name ?? "";
}

function initialFor(status: string): PatientMessageKind {
  if (status === "cancelled") return "appointment_cancelled";
  if (status === "no_show") return "appointment_missed";
  return "booking_confirmation";
}

/** « Envoyer par WhatsApp » pour un rendez-vous (confirmation, rappel, déplacement, annulation...). */
export function AppointmentWhatsApp({ appointmentId, initial, ...look }: { appointmentId: string; initial?: PatientMessageKind } & ButtonLook) {
  const { cabinet } = useCabinet();
  const data = useLiveQuery(async () => {
    const db = localDb();
    const a = await db.appointments.get(appointmentId);
    if (!a || a.deleted_at || !a.patient_id) return null;
    const patient = await db.patients.get(a.patient_id);
    if (!patient || patient.deleted_at) return null;
    return { a, patient, dentist: await dentistName(a.cabinet_id, a.dentist_id) };
  }, [appointmentId]);
  if (!data || !cabinet) return null;
  const vars = appointmentVars(cabinet, data.patient, data.a, data.dentist);
  const options: ComposerOption[] = MESSAGE_CONTEXTS.appointment.map((kind) => ({ kind, vars }));
  return (
    <WhatsAppButton
      phone={data.patient.phone}
      patientName={fullName(data.patient)}
      options={options}
      initial={initial ?? initialFor(data.a.status)}
      {...look}
    />
  );
}

/** « Envoyer la facture par WhatsApp » : facture émise, rappel de paiement, paiement reçu, échéance. */
export function InvoiceWhatsApp({
  invoice,
  patient,
  figures,
  payments,
  installments,
  ...look
}: {
  invoice: Row<"invoices">;
  patient: Row<"patients"> | undefined;
  figures: { total: number; paid: number; balance: number; status: string };
  payments: Row<"payments">[];
  installments: Row<"payment_installments">[];
} & ButtonLook) {
  const { t } = useI18n();
  const { cabinet } = useCabinet();
  if (!cabinet || !patient || figures.status === "draft" || figures.status === "cancelled" || invoice.deleted_at) return null;
  const succeeded = payments.filter((p) => p.status === "succeeded" && !p.deleted_at).sort((a, b) => b.paid_at.localeCompare(a.paid_at));
  const today = todayISO(cabinet.timezone);
  const next = installments
    .filter((i) => !i.deleted_at && i.due_date >= today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const inv = { number: invoice.number, total: figures.total, paid: figures.paid };
  const extra = { provisionalNumber: t("whatsapp.provisionalNumber") };
  const options: ComposerOption[] = [{ kind: "invoice_issued", vars: invoiceVars(cabinet, patient, inv, extra) }];
  if (figures.balance > 0) options.push({ kind: "payment_reminder", vars: invoiceVars(cabinet, patient, inv, extra) });
  if (succeeded[0]) options.push({ kind: "payment_received", vars: invoiceVars(cabinet, patient, inv, { ...extra, amountPaid: Number(succeeded[0].amount_gnf) }) });
  if (next && figures.balance > 0) {
    options.push({
      kind: "installment_due",
      vars: invoiceVars(cabinet, patient, inv, { ...extra, installment: { amount: Number(next.amount_gnf), due_date: next.due_date } }),
    });
  }
  return <WhatsAppButton phone={patient.phone} patientName={fullName(patient)} options={options} label={look.label ?? t("whatsapp.sendInvoice")} {...look} />;
}

/** « Envoyer par WhatsApp » depuis la fiche patient : message libre ou rappel de contrôle. */
export function PatientWhatsApp({ patient, ...look }: { patient: Row<"patients"> } & ButtonLook) {
  const { cabinet } = useCabinet();
  if (!cabinet || patient.deleted_at) return null;
  const vars = baseVars(cabinet, patient);
  const options: ComposerOption[] = [{ kind: "free" }, ...MESSAGE_CONTEXTS.patient.map((kind) => ({ kind, vars }))];
  return <WhatsAppButton phone={patient.phone} patientName={fullName(patient)} options={options} initial="checkup_reminder" {...look} />;
}
