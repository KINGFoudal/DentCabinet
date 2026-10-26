"use client";

import { useState } from "react";
import { Banknote } from "lucide-react";
import type { Enums } from "@/lib/database.types";
import { formatGNF, parseGNF } from "@/lib/format";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/components/ui/cn";
import { changeDue, tenderCovers, tenderSuggestions } from "../lib/cash";
import { useBilling } from "./common";

export type CounterMethod = Enums<"payment_method">;

export const COUNTER_METHODS: CounterMethod[] = ["cash", "orange_money", "mtn_momo", "transfer", "other"];
/** Modes courants, affichés en gros boutons ; les autres en plus petit. */
export const MAIN_METHODS: CounterMethod[] = ["cash", "orange_money", "mtn_momo"];

/** Montant saisi sans le suffixe « GNF ». */
export const amountInput = (n: number) => formatGNF(n).replace(/\s*GNF$/, "");

export const needsReference = (m: CounterMethod) => m === "orange_money" || m === "mtn_momo" || m === "transfer";

export type CounterErrors = { amount?: string; reference?: string; tendered?: string };

export type CounterValue = { amount: number; method: CounterMethod; reference: string | null; tendered: number | null; change: number };

/** État d'un encaissement au comptoir (montant, mode, référence, montant remis en espèces). */
export function useCounterPayment(initialAmount: number | null, initialMethod: CounterMethod = "cash") {
  const [amount, setAmount] = useState(() => (initialAmount == null ? "" : amountInput(initialAmount)));
  const [method, setMethod] = useState<CounterMethod>(initialMethod);
  const [reference, setReference] = useState("");
  const [tendered, setTendered] = useState("");
  const [errors, setErrors] = useState<CounterErrors>({});
  return { amount, setAmount, method, setMethod, reference, setReference, tendered, setTendered, errors, setErrors };
}

export type CounterState = ReturnType<typeof useCounterPayment>;

type T = ReturnType<typeof useBilling>["t"];

/** Vérifie la saisie ; renvoie la valeur à enregistrer ou null (erreurs affichées). */
export function validateCounter(s: CounterState, balance: number, t: T, gnf: (n: number) => string, amountText = s.amount): CounterValue | null {
  const value = parseGNF(amountText);
  const tendered = s.method === "cash" && s.tendered.trim() ? parseGNF(s.tendered) : null;
  const errs: CounterErrors = {};
  if (value == null || value <= 0) errs.amount = t("billing.payment.amountInvalid");
  else if (value > balance) errs.amount = t("billing.payment.amountTooHigh", { balance: gnf(balance) });
  if (needsReference(s.method) && !s.reference.trim()) errs.reference = t("billing.payment.referenceRequired");
  if (s.method === "cash" && s.tendered.trim() && (tendered == null || (value != null && !tenderCovers(value, tendered))))
    errs.tendered = t("billing.cash.tenderedTooLow");
  s.setErrors(errs);
  if (Object.keys(errs).length || value == null) return null;
  return { amount: value, method: s.method, reference: s.reference.trim() || null, tendered, change: changeDue(value, tendered) };
}

/** Boutons des modes de paiement : Espèces en premier, gros boutons pour Espèces / Orange Money / MTN. */
export function MethodPicker({
  value,
  onChange,
  methods = COUNTER_METHODS,
  labelId,
}: {
  value: CounterMethod;
  onChange: (m: CounterMethod) => void;
  methods?: CounterMethod[];
  labelId: string;
}) {
  const { t } = useBilling();
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-3 gap-2">
      {methods.map((m) => {
        const main = MAIN_METHODS.includes(m);
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            onClick={() => onChange(m)}
            className={cn(
              buttonClass(value === m ? "primary" : "secondary", main ? "lg" : "sm", "h-auto px-2 text-center leading-tight"),
              main ? "min-h-12 text-sm" : "min-h-9 text-xs",
            )}
          >
            {m === "cash" && <Banknote className="size-4 shrink-0" aria-hidden />}
            {t(`billing.method.${m}`)}
          </button>
        );
      })}
    </div>
  );
}

/** Montant reçu en espèces et monnaie à rendre. */
export function CashTender({ state, amount }: { state: CounterState; amount: number | null }) {
  const { t, gnf } = useBilling();
  const tendered = state.tendered.trim() ? parseGNF(state.tendered) : null;
  const change = amount != null ? changeDue(amount, tendered) : 0;
  const short = amount != null && tendered != null && !tenderCovers(amount, tendered);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <Field label={t("billing.cash.tendered")} hint={t("billing.cash.tenderedHint")} error={state.errors.tendered}>
        {(p) => (
          <Input
            {...p}
            inputMode="numeric"
            value={state.tendered}
            placeholder={amount != null ? amountInput(amount) : ""}
            onChange={(e) => state.setTendered(e.target.value)}
          />
        )}
      </Field>
      {amount != null && amount > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("billing.cash.quickTendered")}>
          {tenderSuggestions(amount).map((v) => (
            <Button key={v} size="sm" variant={tendered === v ? "primary" : "secondary"} onClick={() => state.setTendered(amountInput(v))}>
              {gnf(v)}
            </Button>
          ))}
        </div>
      )}
      <div
        className={cn("flex items-baseline justify-between gap-2 rounded-lg px-3 py-2", short ? "bg-danger-soft" : "bg-success-soft")}
        aria-live="polite"
        data-testid="change-due"
      >
        <span className="text-sm font-medium">{short ? t("billing.cash.missing") : t("billing.cash.change")}</span>
        <strong className="text-lg">{short && amount != null && tendered != null ? gnf(amount - tendered) : gnf(change)}</strong>
      </div>
    </div>
  );
}

/** Champs d'un encaissement au comptoir : montant, mode, montant reçu (espèces) ou référence. */
export function CounterPaymentFields({
  state,
  balance,
  idPrefix,
  quickAmounts = true,
  autoFocus,
}: {
  state: CounterState;
  balance: number;
  idPrefix: string;
  quickAmounts?: boolean;
  autoFocus?: boolean;
}) {
  const { t, gnf } = useBilling();
  const amount = parseGNF(state.amount);
  const half = Math.ceil(balance / 2);
  const quick = [
    { key: "balance", label: t("billing.payment.quickBalance"), value: balance },
    ...(half > 0 && half < balance ? [{ key: "half", label: t("billing.payment.quickHalf"), value: half }] : []),
  ];
  const labelId = `${idPrefix}-method-label`;
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span id={labelId} className="text-sm font-medium">
          {t("billing.fields.method")} <span className="text-danger">*</span>
        </span>
        <MethodPicker labelId={labelId} value={state.method} onChange={state.setMethod} />
      </div>
      <Field label={t("billing.fields.amount")} required error={state.errors.amount}>
        {(p) => <Input {...p} inputMode="numeric" value={state.amount} onChange={(e) => state.setAmount(e.target.value)} autoFocus={autoFocus} />}
      </Field>
      {quickAmounts && (
        <div className="-mt-1 flex flex-wrap gap-2" role="group" aria-label={t("billing.payment.quickAmounts")}>
          {quick.map((q) => (
            <Button key={q.key} size="sm" variant={amount === q.value ? "primary" : "secondary"} onClick={() => state.setAmount(amountInput(q.value))}>
              {q.label} · {gnf(q.value)}
            </Button>
          ))}
        </div>
      )}
      {state.method === "cash" ? (
        <CashTender state={state} amount={amount} />
      ) : (
        <Field
          label={t("billing.fields.reference")}
          required={needsReference(state.method)}
          error={state.errors.reference}
          hint={needsReference(state.method) ? t("billing.payment.referenceHint") : undefined}
        >
          {(p) => (
            <Input
              {...p}
              value={state.reference}
              onChange={(e) => state.setReference(e.target.value)}
              placeholder={state.method === "orange_money" ? "MP241024.1234.A12345" : ""}
            />
          )}
        </Field>
      )}
    </>
  );
}

/** Adresse du reçu imprimable, avec le montant remis en espèces (monnaie rendue imprimée). */
export function receiptHref(paymentId: string, tendered?: number | null) {
  const q = new URLSearchParams({ id: paymentId });
  if (tendered != null && tendered > 0) q.set("recu", String(Math.round(tendered)));
  return `/app/facturation/recu?${q.toString()}`;
}

/**
 * « Encaisser maintenant » en fin de consultation : Espèces / Orange Money / MTN ou Plus tard.
 * Le montant vide vaut le total de la consultation.
 */
export function CollectNowFields({
  choice,
  onChoice,
  state,
  total,
}: {
  choice: CounterMethod | "later";
  onChoice: (c: CounterMethod | "later") => void;
  state: CounterState;
  total: number;
}) {
  const { t } = useBilling();
  const amount = state.amount.trim() ? parseGNF(state.amount) : total;
  const options: (CounterMethod | "later")[] = [...MAIN_METHODS, "later"];
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={t("billing.consultPay.title")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={choice === m}
            onClick={() => {
              onChoice(m);
              if (m !== "later") state.setMethod(m);
            }}
            className={cn(buttonClass(choice === m ? "primary" : "secondary", "lg", "h-auto min-h-12 px-2 text-center text-sm leading-tight"))}
          >
            {m === "cash" && <Banknote className="size-4 shrink-0" aria-hidden />}
            {m === "later" ? t("billing.consultPay.later") : t(`billing.method.${m}`)}
          </button>
        ))}
      </div>
      {choice !== "later" && (
        <>
          <Field label={t("billing.fields.amount")} error={state.errors.amount}>
            {(p) => <Input {...p} inputMode="numeric" value={state.amount} placeholder={amountInput(total)} onChange={(e) => state.setAmount(e.target.value)} />}
          </Field>
          {choice === "cash" ? (
            <CashTender state={state} amount={amount} />
          ) : (
            <Field label={t("billing.fields.reference")} required error={state.errors.reference} hint={t("billing.payment.referenceHint")}>
              {(p) => <Input {...p} value={state.reference} onChange={(e) => state.setReference(e.target.value)} />}
            </Field>
          )}
        </>
      )}
    </div>
  );
}
