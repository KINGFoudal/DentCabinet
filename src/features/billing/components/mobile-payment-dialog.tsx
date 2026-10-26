"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Smartphone, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { formatGNF, normalizeGuineaPhone, parseGNF } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import {
  initiateMobilePayment,
  isFinal,
  mobilePaymentStatus,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  type ApiResult,
  type MobileProvider,
  type MobileStatus,
} from "../lib/mobile-payment";
import { useBilling } from "./common";
import { useOnline } from "@/lib/use-online";

type Phase =
  | { kind: "form" }
  | { kind: "sending" }
  | { kind: "waiting"; transactionId: string; instructions?: string; redirectUrl?: string }
  | { kind: "done"; status: Exclude<MobileStatus, "pending"> }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

/** Demande de paiement Orange Money / MTN MoMo envoyée au téléphone du patient (en ligne uniquement). */
export function MobilePaymentDialog({
  open,
  onClose,
  invoiceId,
  balance,
  defaultPhone,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  balance: number;
  defaultPhone: string | null;
}) {
  const { t } = useBilling();
  return (
    <Dialog open={open} onClose={onClose} title={t("billing.mobile.title")}>
      {open && <MobileForm invoiceId={invoiceId} balance={balance} defaultPhone={defaultPhone} onClose={onClose} />}
    </Dialog>
  );
}

function errorMessage(t: (k: string, v?: Record<string, string | number>) => string, r: Extract<ApiResult<unknown>, { ok: false }>) {
  if (r.kind === "not_found") return t("billing.mobile.notAvailable");
  if (r.kind === "network") return t("billing.mobile.offline");
  return r.message ? t("billing.mobile.errorWith", { message: r.message }) : t("billing.mobile.error");
}

async function accessToken() {
  return (await supabase().auth.getSession()).data.session?.access_token ?? null;
}

function MobileForm({
  invoiceId,
  balance,
  defaultPhone,
  onClose,
}: {
  invoiceId: string;
  balance: number;
  defaultPhone: string | null;
  onClose: () => void;
}) {
  const { t, gnf } = useBilling();
  const { engine } = useCabinet();
  const [provider, setProvider] = useState<MobileProvider>("orange_money");
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [amount, setAmount] = useState(() => formatGNF(balance).replace(/\s*GNF$/, ""));
  const [errors, setErrors] = useState<{ phone?: string; amount?: string }>({});
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const online = useOnline();
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  // Interrogation du statut toutes les 5 s pendant 2 min.
  const waitingId = phase.kind === "waiting" ? phase.transactionId : null;
  useEffect(() => {
    if (!waitingId) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped.current) return;
      if (Date.now() - started > POLL_TIMEOUT_MS) return setPhase({ kind: "timeout" });
      const token = await accessToken();
      if (!token) return setPhase({ kind: "error", message: t("billing.mobile.sessionExpired") });
      const r = await mobilePaymentStatus(token, waitingId);
      if (stopped.current) return;
      if (r.ok && isFinal(r.data.status)) {
        setPhase({ kind: "done", status: r.data.status as Exclude<MobileStatus, "pending"> });
        if (r.data.status === "succeeded") void engine?.sync();
        return;
      }
      if (!r.ok && r.kind === "not_found") return setPhase({ kind: "error", message: errorMessage(t, r) });
      // En attente ou erreur réseau passagère : on réessaie.
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [waitingId, engine, t]);

  async function send() {
    const normalized = normalizeGuineaPhone(phone);
    const value = parseGNF(amount);
    const errs: typeof errors = {};
    if (!normalized) errs.phone = t("billing.mobile.invalidPhone");
    if (value == null || value <= 0 || value > balance) errs.amount = t("billing.payment.amountTooHigh", { balance: gnf(balance) });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (!navigator.onLine) return setPhase({ kind: "error", message: t("billing.mobile.offline") });
    setPhase({ kind: "sending" });
    const token = await accessToken();
    if (!token) return setPhase({ kind: "error", message: t("billing.mobile.sessionExpired") });
    const r = await initiateMobilePayment(token, {
      invoice_id: invoiceId,
      provider,
      phone: normalized!,
      ...(value !== balance ? { amount_gnf: value! } : {}),
    });
    if (!r.ok) return setPhase({ kind: "error", message: errorMessage(t, r) });
    if (r.data.status === "pending") {
      setPhase({ kind: "waiting", transactionId: r.data.transaction_id, instructions: r.data.instructions, redirectUrl: r.data.redirect_url });
    } else {
      setPhase({ kind: "done", status: r.data.status });
      if (r.data.status === "succeeded") void engine?.sync();
    }
  }

  if (phase.kind === "waiting" || phase.kind === "sending") {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <Spinner className="size-8" />
        <p className="font-medium">{t(phase.kind === "sending" ? "billing.mobile.sending" : "billing.mobile.pending")}</p>
        {phase.kind === "waiting" && phase.instructions && <p className="max-w-sm text-sm text-muted">{phase.instructions}</p>}
        {phase.kind === "waiting" && phase.redirectUrl && (
          <a href={phase.redirectUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary underline">
            {t("billing.mobile.openLink")}
          </a>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    );
  }

  if (phase.kind === "done" || phase.kind === "timeout" || phase.kind === "error") {
    const ok = phase.kind === "done" && phase.status === "succeeded";
    const message =
      phase.kind === "error" ? phase.message : phase.kind === "timeout" ? t("billing.mobile.timeout") : t(`billing.mobile.${phase.status}`);
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        {ok ? <CheckCircle2 className="size-10 text-success" /> : <XCircle className={`size-10 ${phase.kind === "timeout" ? "text-warning" : "text-danger"}`} />}
        <p className="max-w-sm text-sm">{message}</p>
        <div className="flex gap-2">
          {!ok && (
            <Button variant="secondary" onClick={() => setPhase({ kind: "form" })}>
              {t("billing.mobile.retry")}
            </Button>
          )}
          <Button onClick={onClose}>{t("common.close")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!online && <div className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{t("billing.mobile.offline")}</div>}
      <Field label={t("billing.mobile.provider")}>
        {(p) => (
          <Select {...p} value={provider} onChange={(e) => setProvider(e.target.value as MobileProvider)}>
            <option value="orange_money">{t("billing.method.orange_money")}</option>
            <option value="mtn_momo">{t("billing.method.mtn_momo")}</option>
          </Select>
        )}
      </Field>
      <Field label={t("billing.mobile.phone")} required error={errors.phone} hint={t("billing.mobile.phoneHint")}>
        {(p) => <Input {...p} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="620 00 00 00" />}
      </Field>
      <Field label={t("billing.fields.amount")} required error={errors.amount}>
        {(p) => <Input {...p} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <p className="text-xs text-muted">{t("billing.mobile.explain")}</p>
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={send} disabled={!online}>
          <Smartphone className="size-4" />
          {t("billing.mobile.send")}
        </Button>
      </div>
    </div>
  );
}
