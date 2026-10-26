"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/auth-provider";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { isStrongPassword, safeNext, slugify } from "@/lib/auth/validation";
import { authErrorKey } from "@/lib/auth/errors";
import { afterSignupPath, confirmationRedirect, SIGNUP_EMAIL_KEY } from "@/lib/auth/signup";
import { normalizeGuineaPhone } from "@/lib/format";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/input";

export default function SignupPage() {
  return (
    <Suspense>
      <Signup />
    </Suspense>
  );
}

function Signup() {
  const { user, ready } = useAuth();
  const next = useSearchParams().get("next");
  const router = useRouter();
  // Un utilisateur invité rejoint un cabinet existant au lieu d'en créer un.
  useEffect(() => {
    if (ready && user && next) router.replace(safeNext(next));
  }, [ready, user, next, router]);
  if (!ready || (user && next)) return null;
  return user ? <CabinetStep /> : <AccountStep next={next ? safeNext(next) : null} />;
}

function AccountStep({ next }: { next: string | null }) {
  const t = useT();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isStrongPassword(password)) return setError(t("auth.passwordRule"));
    setLoading(true);
    setError(null);
    const address = email.trim();
    const { data, error } = await supabase().auth.signUp({
      email: address,
      password,
      options: { data: { full_name: fullName.trim() }, emailRedirectTo: confirmationRedirect(window.location.origin, next) },
    });
    if (error) {
      setLoading(false);
      return setError(t(authErrorKey(error)));
    }
    // Adresse déjà inscrite : Supabase renvoie un utilisateur sans identité (et n'envoie rien).
    if (data.user && data.user.identities?.length === 0) {
      setLoading(false);
      return setError(t("auth.errors.emailTaken"));
    }
    if (!data.session) {
      // Confirmation d'email requise (production) : on se connecte après avoir cliqué le lien.
      try {
        sessionStorage.setItem(SIGNUP_EMAIL_KEY, address);
      } catch {}
      router.replace(afterSignupPath(next));
      return;
    }
    setLoading(false);
    // Sans confirmation requise, la session ouverte fait passer à l'étape « cabinet ».
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t("auth.signup")}</h1>
      <p className="text-sm text-muted">{t("auth.trialInfo")}</p>
      <Field label={t("auth.fullName")} required>
        {(p) => <Input {...p} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />}
      </Field>
      <Field label={t("auth.email")} required>
        {(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field label={t("auth.password")} required hint={t("auth.passwordRule")} error={error}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <Button type="submit" loading={loading}>
        {t("auth.signup")}
      </Button>
      <p className="text-center text-sm">
        {t("auth.haveAccount")}{" "}
        <Link href={next ? `/connexion?next=${encodeURIComponent(next)}` : "/connexion"} className="text-primary hover:underline">
          {t("auth.login")}
        </Link>
      </p>
    </form>
  );
}

function CabinetStep() {
  const t = useT();
  const router = useRouter();
  const { reloadMemberships, selectCabinet } = useCabinet();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("Conakry");
  const [isDentist, setIsDentist] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalizedPhone = phone ? normalizeGuineaPhone(phone) : null;
    if (phone && !normalizedPhone) return setError(t("auth.errors.invalidPhone"));
    setLoading(true);
    setError(null);
    const { data, error } = await supabase().rpc("create_cabinet", {
      p_name: name.trim(),
      p_slug: slug,
      p_phone: normalizedPhone ?? undefined,
      p_city: city.trim() || undefined,
      p_is_dentist: isDentist,
    });
    if (error) {
      setLoading(false);
      return setError(t(authErrorKey(error)));
    }
    await reloadMemberships();
    selectCabinet(data as string);
    router.replace("/app");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t("auth.createCabinet")}</h1>
      <p className="text-sm text-muted">{t("auth.cabinetStepHint")}</p>
      <Field label={t("auth.cabinetName")} required>
        {(p) => (
          <Input
            {...p}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        )}
      </Field>
      <Field label={t("auth.cabinetSlug")} required hint={`nimba.app/c/${slug || "…"}`}>
        {(p) => (
          <Input
            {...p}
            value={slug}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
          />
        )}
      </Field>
      <Field label={t("auth.cabinetPhone")}>
        {(p) => <Input {...p} type="tel" inputMode="tel" placeholder="620 00 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} />}
      </Field>
      <Field label={t("auth.cabinetCity")}>{(p) => <Input {...p} value={city} onChange={(e) => setCity(e.target.value)} />}</Field>
      <Checkbox label={t("auth.iAmDentist")} checked={isDentist} onChange={(e) => setIsDentist(e.target.checked)} />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" loading={loading} disabled={!name || !slug}>
        {t("auth.createCabinet")}
      </Button>
    </form>
  );
}
