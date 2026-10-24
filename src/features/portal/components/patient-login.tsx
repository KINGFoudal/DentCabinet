"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";
import { useT } from "@/components/i18n-provider";
import { Card, CardBody } from "@/components/ui/card";
import { authPhoneToE164 } from "@/features/portal/lib/schedule";
import { PhoneLogin } from "./phone-login";
import { PatientShell } from "./patient-portal";

export function PatientLogin() {
  const t = useT();
  const router = useRouter();
  const { ready, user } = useAuth();
  const signedIn = ready && !!user && !!authPhoneToE164(user.phone);

  useEffect(() => {
    if (signedIn) router.replace("/patient");
  }, [signedIn, router]);

  return (
    <PatientShell>
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-4">
        <div>
          <h1 className="text-xl font-semibold">{t("portal.login.title")}</h1>
          <p className="text-sm text-muted">{t("portal.login.subtitle")}</p>
        </div>
        <Card>
          <CardBody>
            <PhoneLogin onDone={() => router.replace("/patient")} />
          </CardBody>
        </Card>
        <p className="flex items-start gap-2 text-xs text-muted">
          <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden />
          {t("portal.login.privacy")}
        </p>
      </div>
    </PatientShell>
  );
}
