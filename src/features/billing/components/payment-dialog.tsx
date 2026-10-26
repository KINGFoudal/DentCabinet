"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { issueInvoice, recordPayment } from "../actions";
import { useBilling } from "./common";
import { CounterPaymentFields, receiptHref, useCounterPayment, validateCounter, type CounterValue } from "./counter-payment";

export { COUNTER_METHODS } from "./counter-payment";

/**
 * Encaissement au comptoir (espèces par défaut, Orange Money, MTN MoMo, virement), partiel ou total.
 * Marche hors ligne (écriture locale, envoyée à la synchronisation).
 * issueFirst : facture brouillon, émise juste avant d'enregistrer le paiement (« Émettre et encaisser »).
 */
export function PaymentDialog({
  open,
  onClose,
  invoiceId,
  balance,
  issueFirst,
  title,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  balance: number;
  issueFirst?: boolean;
  /** Ex. numéro et patient, depuis une liste. */
  title?: string;
}) {
  const { t } = useBilling();
  return (
    <Dialog open={open} onClose={onClose} title={title ?? t(issueFirst ? "billing.payment.issueAndCollectTitle" : "billing.payment.title")}>
      {open && <PaymentForm invoiceId={invoiceId} balance={balance} issueFirst={!!issueFirst} onClose={onClose} />}
    </Dialog>
  );
}

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Confirmation après encaissement : monnaie à rendre et reçu imprimable. */
export function PaymentDone({ saved, onReceipt, onClose }: { saved: CounterValue & { id: string }; onReceipt: () => void; onClose: () => void }) {
  const { t, gnf } = useBilling();
  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center" data-testid="payment-done">
      <CheckCircle2 className="size-10 text-success" aria-hidden />
      <p className="font-medium">
        {t("billing.payment.recorded")} · {gnf(saved.amount)} · {t(`billing.method.${saved.method}`)}
      </p>
      {saved.method === "cash" && saved.tendered != null && (
        <div className="w-full rounded-lg bg-success-soft px-4 py-3">
          <div className="text-sm">
            {t("billing.cash.tendered")} : {gnf(saved.tendered)}
          </div>
          <div className="mt-1 text-sm font-medium">{t("billing.cash.change")}</div>
          <div className="text-2xl font-bold" data-testid="change-final">
            {gnf(saved.change)}
          </div>
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onReceipt}>
          <Printer className="size-4" />
          {t("billing.actions.printReceipt")}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}

function PaymentForm({ invoiceId, balance, issueFirst, onClose }: { invoiceId: string; balance: number; issueFirst: boolean; onClose: () => void }) {
  const { t, gnf, cabinetId, userId, today } = useBilling();
  const toast = useToast();
  const router = useRouter();
  const state = useCounterPayment(balance);
  const [paidAt, setPaidAt] = useState(nowLocalInput);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<(CounterValue & { id: string }) | null>(null);

  async function submit() {
    const value = validateCounter(state, balance, t, gnf);
    if (!value || saving) return;
    setSaving(true);
    try {
      if (issueFirst) await issueInvoice(invoiceId, today);
      const p = await recordPayment({
        cabinetId,
        invoiceId,
        amount: value.amount,
        method: value.method,
        reference: value.reference,
        paidAt: new Date(paidAt).toISOString(),
        userId,
        notes: notes.trim() || null,
      });
      toast(t("billing.payment.recorded"));
      setSaved({ ...value, id: p.id });
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <PaymentDone
        saved={saved}
        onClose={onClose}
        onReceipt={() => {
          // Fermer la fenêtre avant de naviguer : la page quittée reste montée (masquée) par Next.
          onClose();
          router.push(receiptHref(saved.id, saved.method === "cash" ? saved.tendered : null));
        }}
      />
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="rounded-lg bg-primary-soft px-3 py-2 text-sm">
        {t("billing.fields.balance")} : <strong>{gnf(balance)}</strong>
      </div>
      {issueFirst && <p className="text-xs text-muted">{t("billing.payment.issueAndCollectHint")}</p>}
      <CounterPaymentFields state={state} balance={balance} idPrefix="payment" autoFocus />
      <Field label={t("billing.fields.paidAt")}>
        {(p) => <Input {...p} type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />}
      </Field>
      <Field label={t("billing.fields.notes")}>
        {(p) => <Textarea {...p} className="min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={saving} title={t("billing.payment.enterHint")}>
          {t(issueFirst ? "billing.actions.issueAndCollect" : "billing.actions.recordPayment")}
        </Button>
      </div>
    </form>
  );
}
