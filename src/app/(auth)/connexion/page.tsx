"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { safeNext } from "@/lib/auth/validation";
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

function Login() {
  const t = useT();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const { user, ready } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace(next);
  }, [ready, user, router, next]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError(t("auth.invalidCredentials"));
    else router.replace(next);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t("auth.login")}</h1>
      <Field label={t("auth.email")} required>
        {(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field label={t("auth.password")} required error={error}>
        {(p) => (
          <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
      </Field>
      <Button type="submit" loading={loading}>
        {t("auth.login")}
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/mot-de-passe" className="text-primary hover:underline">
          {t("auth.forgotPassword")}
        </Link>
        <Link href="/inscription" className="text-primary hover:underline">
          {t("auth.signup")}
        </Link>
      </div>
    </form>
  );
}
