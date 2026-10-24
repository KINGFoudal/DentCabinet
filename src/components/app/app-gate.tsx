"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-provider";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { useT } from "@/components/i18n-provider";
import { PageSpinner } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";

/** Protège l'espace cabinet : session requise et cabinet actif choisi. */
export function AppGate({ children }: { children: ReactNode }) {
  const { ready, user } = useAuth();
  const { ready: cabReady, memberships, cabinetId, selectCabinet } = useCabinet();
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    if (ready && !user) router.replace("/connexion");
  }, [ready, user, router]);

  if (!ready || !user || !cabReady) return <PageSpinner />;

  if (!cabinetId) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6">
        {memberships.length === 0 ? (
          <>
            <p className="text-center text-muted">{t("auth.noCabinet")}</p>
            <a className={buttonClass("primary")} href="/inscription?etape=cabinet">
              {t("auth.createCabinet")}
            </a>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">{t("auth.chooseCabinet")}</h1>
            {memberships.map((m) => (
              <button
                key={m.cabinet_id}
                type="button"
                onClick={() => selectCabinet(m.cabinet_id)}
                className="rounded-xl border border-border bg-surface p-4 text-left hover:border-primary"
              >
                <div className="font-medium">{m.cabinet.name}</div>
                <div className="text-sm text-muted">{m.roles.map((r) => t(`roles.${r}`)).join(", ")}</div>
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  return <>{children}</>;
}

/** Affiche un message si l'utilisateur n'a pas le droit voulu. */
export function RequirePermission({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  const t = useT();
  if (!allowed) return <p className="p-6 text-center text-muted">{t("common.notAllowed")}</p>;
  return <>{children}</>;
}
