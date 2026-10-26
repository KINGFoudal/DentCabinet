"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { loginErrorKey } from "@/features/portal/lib/errors";
import { isPlausibleEmail } from "@/features/portal/lib/identity";

/** Délai avant renvoi : Supabase refuse un nouveau code pour la même adresse avant 60 s. */
const RESEND_SECONDS = 60;
const CODE_LENGTH = 6;

/**
 * Connexion par code à 6 chiffres reçu par email (gratuit, sans fournisseur SMS).
 * Après vérification, les fiches patients portant cette adresse sont rattachées au compte
 * (RPC link_portal_patients, qui n'accepte qu'une session ouverte par code).
 */
export function EmailLogin({ onDone }: { onDone: () => void | Promise<void> }) {
  const t = useT();
  const [step, setStep] = useState<"email" | "code">("email");
  const [raw, setRaw] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
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
    setInfo(null);
    const { error } = await supabase().auth.signInWithOtp({ email: target, options: { shouldCreateUser: true } });
    setLoading(false);
    if (error) {
      setError(t(loginErrorKey(error, "send")));
      return false;
    }
    setCooldown(RESEND_SECONDS);
    return true;
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    const value = raw.trim().toLowerCase();
    if (!isPlausibleEmail(value)) {
      setError(t("portal.login.invalidEmail"));
      return;
    }
    setEmail(value);
    if (await send(value)) {
      setCode("");
      setStep("code");
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    const token = code.replace(/\D/g, "");
    if (token.length !== CODE_LENGTH) {
      setError(t("portal.login.codeLength", { count: String(CODE_LENGTH) }));
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    const { error } = await supabase().auth.verifyOtp({ email, token, type: "email" });
    if (error) {
      setLoading(false);
      setError(t(loginErrorKey(error, "verify")));
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

  if (step === "email") {
    return (
      <form onSubmit={submitEmail} className="flex flex-col gap-4" noValidate>
        <Field label={t("portal.login.email")} hint={t("portal.login.emailHint")} error={error} required>
          {(p) => (
            <Input
              {...p}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="nom@exemple.com"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
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
      <p className="text-sm text-muted" aria-live="polite">
        {info ?? t("portal.login.codeSentEmail", { email: email ?? "" })}
      </p>
      <Field label={t("portal.login.code")} error={error} required>
        {(p) => (
          <Input
            {...p}
            className="h-12 text-center text-lg tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={loading}>
        {t("portal.login.verify")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => {
            setStep("email");
            setError(null);
            setInfo(null);
          }}
        >
          {t("portal.login.changeEmail")}
        </button>
        <button
          type="button"
          className="text-primary hover:underline disabled:text-muted disabled:no-underline"
          disabled={cooldown > 0 || loading}
          onClick={async () => {
            if (email && (await send(email))) setInfo(t("portal.login.codeResent", { email }));
          }}
        >
          {cooldown > 0 ? t("portal.login.resendIn", { seconds: cooldown }) : t("portal.login.resend")}
        </button>
      </div>
    </form>
  );
}
