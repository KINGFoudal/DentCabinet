"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatPhone, normalizeGuineaPhone } from "@/lib/format";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { errorKey } from "@/features/portal/lib/errors";

const RESEND_SECONDS = 45;

/**
 * Connexion par téléphone avec un code à usage unique.
 * Supabase envoie le code via le hook « Send SMS » (livré par WhatsApp côté serveur).
 * Après vérification, les fiches patients portant ce numéro sont rattachées au compte.
 */
export function PhoneLogin({ onDone, submitLabel }: { onDone: () => void | Promise<void>; submitLabel?: string }) {
  const t = useT();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [raw, setRaw] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function send(target: string) {
    setLoading(true);
    setError(null);
    const { error } = await supabase().auth.signInWithOtp({ phone: target });
    setLoading(false);
    if (error) {
      const key = errorKey(error);
      setError(t(key === "portal.errors.generic" ? "portal.login.sendFailed" : key));
      return false;
    }
    setCooldown(RESEND_SECONDS);
    return true;
  }

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    const e164 = normalizeGuineaPhone(raw);
    if (!e164) {
      setError(t("portal.login.invalidPhone"));
      return;
    }
    setPhone(e164);
    if (await send(e164)) {
      setCode("");
      setStep("code");
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!phone) return;
    const token = code.replace(/\D/g, "");
    if (token.length < 4) {
      setError(t("portal.login.invalidCode"));
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await supabase().auth.verifyOtp({ phone, token, type: "sms" });
    if (error) {
      setLoading(false);
      const key = errorKey(error);
      setError(t(key === "portal.errors.generic" ? "portal.login.invalidCode" : key));
      return;
    }
    // Rattachement des fiches : un échec ici n'empêche pas la connexion (refait à l'ouverture de l'espace).
    await supabase()
      .rpc("link_portal_patients")
      .then(
        () => undefined,
        () => undefined,
      );
    await onDone();
    setLoading(false);
  }

  if (step === "phone") {
    return (
      <form onSubmit={submitPhone} className="flex flex-col gap-4" noValidate>
        <Field label={t("portal.login.phone")} hint={t("portal.login.phoneHint")} error={error} required>
          {(p) => (
            <div className="flex items-stretch">
              <span className="flex items-center rounded-l-lg border border-r-0 border-border bg-background px-3 text-sm text-muted">+224</span>
              <Input
                {...p}
                className="rounded-l-none"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="620 00 00 00"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
            </div>
          )}
        </Field>
        <Button type="submit" size="lg" loading={loading}>
          {t("portal.login.sendCode")}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submitCode} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-muted">{t("portal.login.codeSent", { phone: formatPhone(phone) })}</p>
      <Field label={t("portal.login.code")} error={error} required>
        {(p) => (
          <Input
            {...p}
            className="h-12 text-center text-lg tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={loading}>
        {submitLabel ?? t("portal.login.verify")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => {
            setStep("phone");
            setError(null);
          }}
        >
          {t("portal.login.changePhone")}
        </button>
        <button
          type="button"
          className="text-primary hover:underline disabled:text-muted disabled:no-underline"
          disabled={cooldown > 0 || loading}
          onClick={() => phone && void send(phone)}
        >
          {cooldown > 0 ? t("portal.login.resendIn", { seconds: cooldown }) : t("portal.login.resend")}
        </button>
      </div>
    </form>
  );
}
