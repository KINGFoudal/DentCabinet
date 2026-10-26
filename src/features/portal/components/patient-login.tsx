"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { useT } from "@/components/i18n-provider";
import { Card, CardBody } from "@/components/ui/card";
import { PHONE_LOGIN_ENABLED, portalIdentity } from "@/features/portal/lib/identity";
import { EmailLogin } from "./email-login";
import { PhoneLogin } from "./phone-login";
import { PatientShell } from "./patient-portal";

/**
 * Connexion à l'espace patient. Par défaut : code reçu par email.
 * La connexion par téléphone (code SMS/WhatsApp) n'est proposée que si
 * NEXT_PUBLIC_PORTAL_PHONE_LOGIN=1 (fournisseur Phone activé dans Supabase).
 */
export function PatientLogin() {
  const t = useT();
  const router = useRouter();
  const { ready, user } = useAuth();
  const [method, setMethod] = useState<"email" | "phone">("email");
  const signedIn = ready && !!portalIdentity(user);

  useEffect(() => {
    if (signedIn) router.replace("/patient");
  }, [signedIn, router]);

  const done = () => router.replace("/patient");

  return (
    <PatientShell>
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-4">
        <div>
          <h1 className="text-xl font-semibold">{t("portal.login.title")}</h1>
          <p className="text-sm text-muted">{t(method === "email" ? "portal.login.subtitleEmail" : "portal.login.subtitle")}</p>
        </div>
        <Card>
          <CardBody>{method === "email" ? <EmailLogin key="email" onDone={done} /> : <PhoneLogin key="phone" onDone={done} />}</CardBody>
        </Card>
        {PHONE_LOGIN_ENABLED && (
          <button
            type="button"
            className="self-start text-sm text-primary hover:underline"
            onClick={() => setMethod((m) => (m === "email" ? "phone" : "email"))}
          >
            {t(method === "email" ? "portal.login.usePhone" : "portal.login.useEmail")}
          </button>
        )}
        <p className="flex items-start gap-2 text-xs text-muted">
          <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden />
          {t("portal.login.privacy")}
        </p>
      </div>
    </PatientShell>
  );
}
