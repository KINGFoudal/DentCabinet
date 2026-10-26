"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Smartphone, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button, buttonClass } from "@/components/ui/button";
import { Spinner } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/components/ui/cn";
import { formatGNF, normalizeGuineaPhone, parseGNF } from "@/lib/format";
import { initiatePayment, validAmount, type Provider } from "@/features/portal/lib/payments";
import { pollPaymentStatus } from "@/lib/payments/poll";
import { balance, type PortalInvoice } from "@/features/portal/lib/portal-data";

type Phase = "form" | "pending" | "succeeded" | "failed" | "expired" | "timeout" | "unavailable";

const PROVIDERS: Provider[] = ["orange_money", "mtn_momo"];

const browserFetch = (input: string, init?: RequestInit) => fetch(input, init);

async function accessToken() {
  return (await supabase().auth.getSession()).data.session?.access_token ?? null;
}

export function PayDialog({
  invoice,
  defaultPhone,
  onClose,
  onPaid,
}: {
  invoice: PortalInvoice | null;
  defaultPhone: string | null;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { t, locale } = useI18n();
  const max = invoice ? balance(invoice) : 0;
  const [provider, setProvider] = useState<Provider>("orange_money");
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [amount, setAmount] = useState(formatGNF(max, "fr").replace(/\s*GNF$/, ""));
  const [phase, setPhase] = useState<Phase>("form");
  const [instructions, setInstructions] = useState<string | null>(null);
  const [redirect, setRedirect] = useState<string | null>(null);
  const [error, setError] = useState<{ field: "phone" | "amount" | "form"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // Arrête l'interrogation à la fermeture.
  useEffect(() => () => abort.current?.abort(), []);

  function close() {
    abort.current?.abort();
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    const e164 = normalizeGuineaPhone(phone);
    if (!e164) return setError({ field: "phone", message: t("portal.login.invalidPhone") });
    const value = parseGNF(amount);
    if (!validAmount(value, max)) return setError({ field: "amount", message: t("portal.pay.invalidAmount", { max: formatGNF(max, locale) }) });
    if (!navigator.onLine) return setError({ field: "form", message: t("portal.errors.offline") });
    const token = await accessToken();
    if (!token) return setError({ field: "form", message: t("portal.errors.not_authenticated") });

    setBusy(true);
    setError(null);
    const r = await initiatePayment(browserFetch, token, {
      purpose: "invoice",
      invoice_id: invoice.id,
      provider,
      phone: e164,
      amount_gnf: value,
    });
    setBusy(false);
    if (!r.ok) {
      if (r.reason === "unavailable") setPhase("unavailable");
      else setError({ field: "form", message: r.message ?? t(r.reason === "offline" ? "portal.errors.offline" : "portal.errors.generic") });
      return;
    }
    setInstructions(r.instructions ?? null);
    setRedirect(r.redirect_url ?? null);
    if (r.status !== "pending") {
      setPhase(r.status);
      if (r.status === "succeeded") onPaid();
      return;
    }
    setPhase("pending");
    const ctrl = new AbortController();
    abort.current = ctrl;
    const final = await pollPaymentStatus({ fetchFn: browserFetch, token: accessToken, id: r.transaction_id, signal: ctrl.signal });
    if (final === "aborted") return;
    setPhase(final);
    if (final === "succeeded") onPaid();
  }

  const footer =
    phase === "form" ? undefined : phase === "failed" || phase === "expired" ? (
      <>
        <Button variant="secondary" onClick={close}>
          {t("portal.pay.close")}
        </Button>
        <Button onClick={() => setPhase("form")}>{t("portal.pay.tryAgain")}</Button>
      </>
    ) : (
      <Button variant="secondary" onClick={close}>
        {t("portal.pay.close")}
      </Button>
    );

  return (
    <Dialog open={!!invoice} onClose={close} title={t("portal.pay.title", { number: invoice?.number ?? "" })} footer={footer}>
      {phase === "form" && (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">{t("portal.pay.provider")}</legend>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map((p) => (
                <label
                  key={p}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-3 text-sm",
                    provider === p ? "border-primary bg-primary-soft font-medium" : "border-border",
                  )}
                >
                  <input type="radio" name="provider" value={p} checked={provider === p} onChange={() => setProvider(p)} className="accent-primary" />
                  {t(`portal.pay.${p}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={t("portal.pay.phone")} error={error?.field === "phone" ? error.message : undefined} required>
            {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
          </Field>
          <Field
            label={t("portal.pay.amount")}
            hint={t("portal.pay.amountHint", { max: formatGNF(max, locale) })}
            error={error?.field === "amount" ? error.message : undefined}
            required
          >
            {(p) => <Input {...p} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          {error?.field === "form" && <p className="text-sm text-danger">{error.message}</p>}
          <Button type="submit" size="lg" loading={busy}>
            {t("portal.pay.submit", { amount: formatGNF(parseGNF(amount) ?? 0, locale) })}
          </Button>
        </form>
      )}

      {phase === "pending" && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <Smartphone className="size-10 text-primary" aria-hidden />
          <p className="font-medium">{instructions ?? t("portal.pay.pendingHint")}</p>
          {redirect && (
            <a href={redirect} target="_blank" rel="noopener noreferrer" className={buttonClass("primary")}>
              {t("portal.pay.openProvider")}
            </a>
          )}
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner className="size-4" />
            {t("portal.pay.waiting")}
          </p>
        </div>
      )}

      {phase !== "form" && phase !== "pending" && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          {phase === "succeeded" ? (
            <CheckCircle2 className="size-10 text-success" aria-hidden />
          ) : phase === "timeout" || phase === "unavailable" ? (
            <Smartphone className="size-10 text-warning" aria-hidden />
          ) : (
            <XCircle className="size-10 text-danger" aria-hidden />
          )}
          <p className="font-medium">{t(`portal.pay.${phase}`)}</p>
        </div>
      )}
    </Dialog>
  );
}
