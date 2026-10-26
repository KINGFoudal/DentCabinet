"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LogOut, UserRoundSearch, WifiOff } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/auth-provider";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { EmptyState, PageSpinner } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/components/ui/cn";
import { formatPhone } from "@/lib/format";
import { errorKey } from "@/features/portal/lib/errors";
import { portalIdentity } from "@/features/portal/lib/identity";
import { loadPortalData, type PortalData, type PortalInvoice } from "@/features/portal/lib/portal-data";
import { PortalFooter, PortalHeader } from "./portal-header";
import { AppointmentsSection, BillingSection, DocumentsSection, PrescriptionsSection } from "./portal-sections";
import { PayDialog } from "./pay-dialog";

type Tab = "appointments" | "billing" | "prescriptions" | "documents";
type LoadState = { key: string; data: PortalData | null; error: string | null };

/** Session patient requise (connexion par code email ou téléphone) ; sinon redirection vers la connexion. */
export function usePatientSession() {
  const { ready, user } = useAuth();
  const router = useRouter();
  const ok = !!portalIdentity(user);
  useEffect(() => {
    if (ready && !ok) router.replace("/patient/connexion");
  }, [ready, ok, router]);
  return { ready: ready && ok, user: ok ? user : null };
}

/** Chargement des données de l'espace patient ; `reload()` relance la lecture. */
export function usePortalData(userId: string | null) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<LoadState | null>(null);
  const key = userId ? `${userId}:${version}` : "";
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    loadPortalData(supabase(), userId).then(
      (data) => !cancelled && setState({ key, data, error: null }),
      (e) => !cancelled && setState({ key, data: null, error: errorKey(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [userId, key]);
  const fresh = state?.key === key;
  return {
    // On garde les données précédentes pendant un rechargement (pas de clignotement).
    data: state?.data ?? null,
    error: fresh ? state.error : null,
    loading: !fresh,
    reload: () => setVersion((v) => v + 1),
  };
}

export function PatientShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <PortalHeader href="/patient" title={t("portal.login.title")} actions={actions} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-5">{children}</main>
      <PortalFooter />
    </div>
  );
}

export function PatientPortal() {
  const { t } = useI18n();
  const router = useRouter();
  const { signOut } = useAuth();
  const { ready, user } = usePatientSession();
  const { data, error, loading, reload } = usePortalData(user?.id ?? null);
  const [tab, setTab] = useState<Tab>("appointments");
  const [cabinetFilter, setCabinetFilter] = useState<string>("all");
  const [paying, setPaying] = useState<PortalInvoice | null>(null);
  const identity = portalIdentity(user);
  const phone = identity?.kind === "phone" ? identity.value : null;
  const identityLabel = identity ? (identity.kind === "phone" ? formatPhone(identity.value) : identity.value) : "";

  const view = useMemo<PortalData | null>(() => {
    if (!data) return null;
    if (cabinetFilter === "all") return data;
    const keep = <R extends { cabinet_id: string }>(l: R[]) => l.filter((x) => x.cabinet_id === cabinetFilter);
    return {
      cabinets: data.cabinets.filter((c) => c.id === cabinetFilter),
      patients: keep(data.patients),
      appointments: keep(data.appointments),
      invoices: keep(data.invoices),
      quotes: keep(data.quotes),
      prescriptions: keep(data.prescriptions),
      documents: keep(data.documents),
    };
  }, [data, cabinetFilter]);

  const lookup = useMemo(
    () => ({
      cabinet: (id: string) => data?.cabinets.find((c) => c.id === id),
      showCabinet: (data?.cabinets.length ?? 0) > 1 && cabinetFilter === "all",
    }),
    [data, cabinetFilter],
  );

  async function logout() {
    await signOut();
    router.replace("/patient/connexion");
  }

  const logoutButton = (
    <Button variant="ghost" size="sm" onClick={logout} aria-label={t("portal.home.logout")}>
      <LogOut className="size-4" />
      <span className="hidden sm:inline">{t("portal.home.logout")}</span>
    </Button>
  );

  if (!ready || !user) return <PageSpinner />;

  if (!data) {
    return (
      <PatientShell actions={logoutButton}>
        {error ? (
          <EmptyState
            icon={<WifiOff />}
            title={t("portal.home.loadFailed")}
            description={t(error)}
            action={<Button onClick={reload}>{t("portal.retry")}</Button>}
          />
        ) : (
          <PageSpinner />
        )}
      </PatientShell>
    );
  }

  const first = data.patients[0];
  const unpaid = data.invoices.filter((i) => i.status === "issued" || i.status === "partially_paid").length;

  return (
    <PatientShell actions={logoutButton}>
      <div>
        <h1 className="text-xl font-semibold">
          {first ? t("portal.home.hello", { name: first.first_name }) : t("portal.home.helloAnon")}
        </h1>
        <p className="break-all text-sm text-muted">{identityLabel}</p>
      </div>
      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {t(error)}{" "}
          <button type="button" className="underline" onClick={reload}>
            {t("portal.retry")}
          </button>
        </p>
      )}

      {data.patients.length === 0 ? (
        <EmptyState
          icon={<UserRoundSearch />}
          title={t("portal.home.noRecordsTitle")}
          description={
            identity?.kind === "email"
              ? t("portal.home.noRecordsTextEmail", { email: identity.value })
              : t("portal.home.noRecordsText", { phone: identityLabel })
          }
        />
      ) : (
        <>
          {data.cabinets.length > 1 && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
              {[{ id: "all", name: t("portal.home.all") }, ...data.cabinets].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={cabinetFilter === c.id}
                  onClick={() => setCabinetFilter(c.id)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-sm",
                    cabinetFilter === c.id ? "border-primary bg-primary text-on-primary" : "border-border bg-surface",
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { value: "appointments", label: t("portal.home.tabs.appointments") },
              { value: "billing", label: unpaid ? `${t("portal.home.tabs.billing")} (${unpaid})` : t("portal.home.tabs.billing") },
              { value: "prescriptions", label: t("portal.home.tabs.prescriptions") },
              { value: "documents", label: t("portal.home.tabs.documents") },
            ]}
          />
          <div className={cn(loading && "opacity-60")}>
            {view && tab === "appointments" && <AppointmentsSection data={view} lookup={lookup} onChanged={reload} />}
            {view && tab === "billing" && <BillingSection data={view} lookup={lookup} onPay={setPaying} />}
            {view && tab === "prescriptions" && <PrescriptionsSection data={view} lookup={lookup} />}
            {view && tab === "documents" && <DocumentsSection data={view} lookup={lookup} />}
          </div>
        </>
      )}
      {paying && (
        <PayDialog key={paying.id} invoice={paying} defaultPhone={phone} onClose={() => setPaying(null)} onPaid={reload} />
      )}
    </PatientShell>
  );
}
