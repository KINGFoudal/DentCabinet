"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { isStrongPassword } from "@/lib/auth/validation";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

/** Demande de réinitialisation, puis saisie du nouveau mot de passe au retour du lien email. */
export default function PasswordPage() {
  const t = useT();
  const router = useRouter();
  const [recovery, setRecovery] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { data } = supabase().auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/mot-de-passe` });
    setLoading(false);
    setMessage(t("auth.resetSent"));
  }

  async function update(e: React.FormEvent) {
    e.preventDefault();
    if (!isStrongPassword(password)) return setError(t("auth.passwordRule"));
    setLoading(true);
    const { error } = await supabase().auth.updateUser({ password });
    setLoading(false);
    if (error) setError(error.message);
    else router.replace("/app");
  }

  if (recovery) {
    return (
      <form onSubmit={update} className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">{t("auth.newPassword")}</h1>
        <Field label={t("auth.newPassword")} required hint={t("auth.passwordRule")} error={error}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" loading={loading}>
          {t("common.save")}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={request} className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t("auth.resetPassword")}</h1>
      <Field label={t("auth.email")} required>
        {(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      {message && <p className="text-sm text-success">{message}</p>}
      <Button type="submit" loading={loading}>
        {t("auth.resetPassword")}
      </Button>
    </form>
  );
}
