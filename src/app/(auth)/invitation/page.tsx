"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/auth-provider";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { useT } from "@/components/i18n-provider";
import { Button, buttonClass } from "@/components/ui/button";

export default function InvitationPage() {
  return (
    <Suspense>
      <Invitation />
    </Suspense>
  );
}

function Invitation() {
  const t = useT();
  const token = useSearchParams().get("token");
  const { user, ready } = useAuth();
  const { reloadMemberships, selectCabinet } = useCabinet();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!ready) return null;
  if (!token) return <p className="text-danger">{t("auth.invitationInvalid")}</p>;

  if (!user) {
    const next = encodeURIComponent(`/invitation?token=${token}`);
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">{t("auth.acceptInvitation")}</h1>
        <Link href={`/inscription?next=${next}`} className={buttonClass("primary")}>
          {t("auth.signup")}
        </Link>
        <Link href={`/connexion?next=${next}`} className={buttonClass("secondary")}>
          {t("auth.login")}
        </Link>
      </div>
    );
  }

  async function accept() {
    setLoading(true);
    const { data, error } = await supabase().rpc("accept_invitation", { p_token: token! });
    if (error) {
      setLoading(false);
      return setError(t("auth.invitationInvalid"));
    }
    await reloadMemberships();
    selectCabinet(data as string);
    router.replace("/app");
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-semibold">{t("auth.acceptInvitation")}</h1>
      <p className="text-sm text-muted">{user.email}</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button onClick={accept} loading={loading}>
        {t("auth.acceptInvitation")}
      </Button>
    </div>
  );
}
