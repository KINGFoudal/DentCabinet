"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { safeNext } from "@/lib/auth/validation";
import { authErrorKey } from "@/lib/auth/errors";
import { SIGNUP_EMAIL_KEY } from "@/lib/auth/signup";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/auth-provider";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

/**
 * Page après connexion : `next` s'il est fourni (invitation...), sinon l'étape « Créer mon
 * cabinet » pour un compte sans cabinet, sinon l'espace cabinet.
 */
async function destination(userId: string, rawNext: string | null) {
  if (rawNext) return safeNext(rawNext);
  const { count, error } = await supabase()
    .from("memberships")
    .select("cabinet_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("active", true)
    .is("deleted_at", null);
  return !error && count === 0 ? "/inscription" : "/app";
}

function Login() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const rawNext = params.get("next");
  const justSignedUp = params.get("inscrit") === "1";
  const confirmed = params.get("confirme") === "1";
  const { user, ready } = useAuth();
  const [email, setEmail] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const routing = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Email saisi à l'inscription : pré-rempli (gardé dans l'onglet, pas dans l'URL).
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SIGNUP_EMAIL_KEY);
      if (saved) {
        /* eslint-disable react-hooks/set-state-in-effect -- lecture unique au montage */
        setEmail(saved);
        setSignupEmail(saved);
        /* eslint-enable react-hooks/set-state-in-effect */
        passwordRef.current?.focus();
      }
    } catch {}
  }, []);

  // Session ouverte (connexion, ou lien de confirmation reçu par email) : redirection.
  useEffect(() => {
    if (!ready || !user || routing.current) return;
    routing.current = true;
    void destination(user.id, rawNext).then((to) => {
      try {
        sessionStorage.removeItem(SIGNUP_EMAIL_KEY);
      } catch {}
      router.replace(to);
    });
  }, [ready, user, router, rawNext]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setLoading(false);
      setError(t(authErrorKey(error)));
    }
    // Succès : la session ouverte déclenche la redirection ci-dessus.
  }

  const signupHref = rawNext ? `/inscription?next=${encodeURIComponent(safeNext(rawNext))}` : "/inscription";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t("auth.login")}</h1>
      {(justSignedUp || confirmed) && (
        <div role="status" className="flex gap-2 rounded-lg border border-success/30 bg-success-soft p-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{t(confirmed ? "auth.emailConfirmed" : "auth.accountCreated")}</p>
            {!confirmed && signupEmail && <p className="mt-1 text-text">{t("auth.accountCreatedHint", { email: signupEmail })}</p>}
          </div>
        </div>
      )}
      <Field label={t("auth.email")} required>
        {(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!justSignedUp} />}
      </Field>
      <Field label={t("auth.password")} required error={error}>
        {(p) => (
          <Input
            {...p}
            ref={passwordRef}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" loading={loading}>
        {t("auth.login")}
      </Button>
      <div className="flex justify-between gap-3 text-sm">
        <Link href="/mot-de-passe" className="text-primary hover:underline">
          {t("auth.forgotPassword")}
        </Link>
        <Link href={signupHref} className="text-right text-primary hover:underline">
          {t("auth.signup")}
        </Link>
      </div>
    </form>
  );
}
