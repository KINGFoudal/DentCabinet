"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Smartphone, XCircle } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { formatPhone, normalizeGuineaPhone } from "@/lib/format";
import {
  initiateMobilePayment,
  mobilePaymentStatus,
  PaymentRequestError,
  simulateSandboxPayment,
  type InitiateRequest,
  type TxStatus,
} from "@/lib/payments/client";
import type { ProviderId } from "@/lib/payments/types";

type Tracking = {
  id: string;
  status: TxStatus;
  instructions?: string;
  redirectUrl?: string;
  sandbox?: boolean;
};

const POLL_MS = 4000;
const POLL_LIMIT_MS = 16 * 60 * 1000;

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/**
 * Paiement par Orange Money ou MTN MoMo : choix de l'opérateur, numéro, puis suivi du statut
 * (interrogation de /api/payments/status). Le statut ne vient jamais du navigateur.
 */
export function MobilePayment({
  request,
  amountLabel,
  defaultPhone,
  disabled,
  resumeId,
  onFinished,
}: {
  request: Omit<InitiateRequest, "provider" | "phone">;
  amountLabel: string;
  defaultPhone?: string | null;
  disabled?: boolean;
  /** Transaction à reprendre (retour depuis la page de l'opérateur : ?payment=<id>). */
  resumeId?: string | null;
  onFinished?: (status: TxStatus) => void;
}) {
  const { t, locale } = useI18n();
  const online = useOnline();
  const [provider, setProvider] = useState<ProviderId>("orange_money");
  const [phone, setPhone] = useState(defaultPhone ? formatPhone(defaultPhone) : "");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tracking, setTracking] = useState<Tracking | null>(resumeId ? { id: resumeId, status: "pending" } : null);
  const startedAt = useRef(0);
  const finishedRef = useRef(onFinished);
  useEffect(() => {
    finishedRef.current = onFinished;
  }, [onFinished]);

  const errorText = useCallback(
    (e: unknown) => {
      const code = e instanceof PaymentRequestError ? e.code : "generic";
      const key = `subscription.payment.error.${code}`;
      const text = t(key);
      return text === key ? t("subscription.payment.error.generic") : text;
    },
    [t],
  );

  const check = useCallback(
    async (id: string) => {
      try {
        const { status } = await mobilePaymentStatus(id, locale);
        setTracking((tr) => (tr && tr.id === id ? { ...tr, status } : tr));
        if (status !== "pending") finishedRef.current?.(status);
      } catch {
        // Erreur réseau passagère : on réessaiera au prochain tour.
      }
    },
    [locale],
  );

  // Suivi périodique tant que la transaction est en attente.
  const trackingId = tracking?.id;
  const pending = tracking?.status === "pending";
  useEffect(() => {
    if (!trackingId || !pending) return;
    startedAt.current = Date.now();
    const first = setTimeout(() => void check(trackingId), 0);
    const timer = setInterval(() => {
      if (Date.now() - startedAt.current > POLL_LIMIT_MS) return clearInterval(timer);
      if (navigator.onLine) void check(trackingId);
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [trackingId, pending, check]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = normalizeGuineaPhone(phone);
    if (!normalized || !/^\+224\d{9}$/.test(normalized)) return setPhoneError(t("subscription.payment.phoneInvalid"));
    setPhoneError(null);
    if (!navigator.onLine) return setError(t("subscription.payment.offline"));
    setBusy(true);
    try {
      const r = await initiateMobilePayment({ ...request, provider, phone: normalized }, locale);
      setTracking({ id: r.transaction_id, status: r.status, instructions: r.instructions, redirectUrl: r.redirect_url, sandbox: r.sandbox });
      if (r.status !== "pending") onFinished?.(r.status);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function simulate(outcome: "succeeded" | "failed") {
    if (!tracking) return;
    setBusy(true);
    try {
      const { status } = await simulateSandboxPayment(tracking.id, outcome, locale);
      setTracking({ ...tracking, status });
      if (status !== "pending") onFinished?.(status);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (tracking) {
    const s = tracking.status;
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg border p-3 text-sm",
            s === "pending" && "border-info/30 bg-info-soft",
            s === "succeeded" && "border-success/30 bg-success-soft",
            (s === "failed" || s === "expired") && "border-danger/30 bg-danger-soft",
          )}
        >
          {s === "pending" ? (
            <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-info" />
          ) : s === "succeeded" ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
          ) : (
            <XCircle className="mt-0.5 size-5 shrink-0 text-danger" />
          )}
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t(`subscription.payment.${s}`)}</p>
            {s === "pending" && tracking.instructions && <p className="text-muted">{tracking.instructions}</p>}
          </div>
        </div>

        {s === "pending" && (
          <div className="flex flex-wrap gap-2">
            {tracking.redirectUrl && (
              <a href={tracking.redirectUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("primary")}>
                <ExternalLink className="size-4" />
                {t("subscription.payment.openProvider")}
              </a>
            )}
            <Button variant="secondary" onClick={() => void check(tracking.id)}>
              {t("subscription.payment.checkNow")}
            </Button>
          </div>
        )}

        {s === "pending" && tracking.sandbox && (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-warning/50 p-3">
            <Badge tone="warning" className="self-start">
              {t("subscription.payment.sandbox")}
            </Badge>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void simulate("succeeded")} loading={busy}>
                {t("subscription.payment.simulateSuccess")}
              </Button>
              <Button size="sm" variant="danger" onClick={() => void simulate("failed")} disabled={busy}>
                {t("subscription.payment.simulateFailure")}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        {s !== "pending" && s !== "succeeded" && (
          <Button variant="secondary" className="self-start" onClick={() => setTracking(null)}>
            {t("subscription.payment.retry")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">{t("subscription.payment.provider")}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(["orange_money", "mtn_momo"] as const).map((p) => (
            <label
              key={p}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm",
                provider === p ? "border-primary bg-primary-soft" : "border-border hover:border-primary/50",
              )}
            >
              <input
                type="radio"
                name="provider"
                value={p}
                checked={provider === p}
                onChange={() => setProvider(p)}
                className="size-4 accent-primary"
              />
              <Smartphone className="size-4 text-muted" />
              <span className="font-medium">{t(`subscription.payment.${p}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label={t("subscription.payment.phone")} hint={t("subscription.payment.phoneHint")} error={phoneError} required>
        {(p) => (
          <Input
            {...p}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="620 00 00 00"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        )}
      </Field>

      {!online && <p className="text-sm text-warning">{t("subscription.payment.offline")}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      <Button type="submit" size="lg" loading={busy} disabled={disabled || !online}>
        {t("subscription.payButton", { amount: amountLabel })}
      </Button>
    </form>
  );
}
