"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Enums } from "@/lib/database.types";
import { formatGNF, parseGNF } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { recordPayment } from "../actions";
import { useBilling } from "./common";

export const COUNTER_METHODS: Enums<"payment_method">[] = ["cash", "orange_money", "mtn_momo", "transfer", "other"];

/** Paiement au comptoir (espèces, Orange Money, MTN MoMo, virement), partiel ou total. */
export function PaymentDialog({ open, onClose, invoiceId, balance }: { open: boolean; onClose: () => void; invoiceId: string; balance: number }) {
  const { t } = useBilling();
  return (
    <Dialog open={open} onClose={onClose} title={t("billing.payment.title")}>
      {open && <PaymentForm invoiceId={invoiceId} balance={balance} onClose={onClose} />}
    </Dialog>
  );
}

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function PaymentForm({ invoiceId, balance, onClose }: { invoiceId: string; balance: number; onClose: () => void }) {
  const { t, gnf, cabinetId, userId } = useBilling();
  const toast = useToast();
  const router = useRouter();
  const [amount, setAmount] = useState(() => formatGNF(balance).replace(/\s*GNF$/, ""));
  const [method, setMethod] = useState<Enums<"payment_method">>("cash");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(nowLocalInput);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<{ amount?: string; reference?: string }>({});
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const needsReference = method === "orange_money" || method === "mtn_momo" || method === "transfer";

  async function submit() {
    const value = parseGNF(amount);
    const errs: typeof errors = {};
    if (value == null || value <= 0) errs.amount = t("billing.payment.amountInvalid");
    else if (value > balance) errs.amount = t("billing.payment.amountTooHigh", { balance: gnf(balance) });
    if (needsReference && !reference.trim()) errs.reference = t("billing.payment.referenceRequired");
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const p = await recordPayment({
        cabinetId,
        invoiceId,
        amount: value!,
        method,
        reference: reference.trim() || null,
        paidAt: new Date(paidAt).toISOString(),
        userId,
        notes: notes.trim() || null,
      });
      toast(t("billing.payment.recorded"));
      setSavedId(p.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  if (savedId) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <p className="font-medium">{t("billing.payment.recorded")}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              // Fermer la fenêtre avant de naviguer : la page quittée reste montée (masquée) par Next.
              onClose();
              router.push(`/app/facturation/recu?id=${savedId}`);
            }}
          >
            {t("billing.actions.printReceipt")}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg bg-primary-soft px-3 py-2 text-sm">
        {t("billing.fields.balance")} : <strong>{gnf(balance)}</strong>
      </div>
      <Field label={t("billing.fields.amount")} required error={errors.amount}>
        {(p) => <Input {...p} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}
      </Field>
      <Field label={t("billing.fields.method")} required>
        {(p) => (
          <Select {...p} value={method} onChange={(e) => setMethod(e.target.value as Enums<"payment_method">)}>
            {COUNTER_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`billing.method.${m}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={t("billing.fields.reference")}
        required={needsReference}
        error={errors.reference}
        hint={needsReference ? t("billing.payment.referenceHint") : undefined}
      >
        {(p) => <Input {...p} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === "orange_money" ? "MP241024.1234.A12345" : ""} />}
      </Field>
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
        <Button onClick={submit} loading={saving}>
          {t("billing.actions.recordPayment")}
        </Button>
      </div>
    </div>
  );
}
