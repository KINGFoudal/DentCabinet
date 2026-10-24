"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Info, Lock, Users } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { localDb } from "@/lib/local/db";
import { supabase } from "@/lib/supabase/client";
import { formatDate, formatDateTime, formatGNF } from "@/lib/format";
import { subscriptionQuote, type Cycle } from "@/lib/payments/pricing";
import type { Tables } from "@/lib/database.types";
import { Card, CardBody, CardHeader, PageHeader, PageSpinner } from "@/components/ui/card";
import { Badge, type Tone } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { RequirePermission } from "@/components/app/app-gate";
import { subscriptionView } from "../state";
import { MobilePayment } from "./mobile-payment";

const STATUS_TONE: Record<string, Tone> = {
  trialing: "info",
  active: "success",
  past_due: "warning",
  expired: "danger",
  cancelled: "neutral",
};

type History = {
  payments: Tables<"subscription_payments">[];
  attempts: Tables<"payment_transactions">[];
} | null;

export function SubscriptionPage() {
  const { can } = useCabinet();
  const { t } = useI18n();
  return (
    <RequirePermission allowed={can.subscription}>
      <PageHeader title={t("subscription.title")} subtitle={t("subscription.subtitle")} />
      <SubscriptionContent />
    </RequirePermission>
  );
}

function SubscriptionContent() {
  const { t, locale } = useI18n();
  const { cabinet, cabinetId, engine } = useCabinet();
  const resumeId = useSearchParams().get("payment");
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [history, setHistory] = useState<History>(null);
  const [historyError, setHistoryError] = useState(false);
  const [payKey, setPayKey] = useState(0);

  const plans = useLiveQuery(() => localDb().plans.toArray(), []);
  const dentists = useLiveQuery(
    () =>
      cabinetId
        ? localDb()
            .memberships.where("cabinet_id")
            .equals(cabinetId)
            .filter((m) => m.active && !m.deleted_at && m.roles.includes("dentist"))
            .count()
        : 0,
    [cabinetId],
  );

  const loadHistory = useCallback(async () => {
    if (!cabinetId) return;
    if (!navigator.onLine) return setHistoryError(true);
    const sb = supabase();
    const [p, a] = await Promise.all([
      sb.from("subscription_payments").select("*").eq("cabinet_id", cabinetId).order("created_at", { ascending: false }).limit(50),
      sb
        .from("payment_transactions")
        .select("*")
        .eq("cabinet_id", cabinetId)
        .eq("purpose", "subscription")
        .neq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    if (p.error || a.error) return setHistoryError(true);
    setHistoryError(false);
    setHistory({ payments: p.data ?? [], attempts: a.data ?? [] });
  }, [cabinetId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial depuis le serveur
    void loadHistory();
  }, [loadHistory]);

  const activePlans = useMemo(() => (plans ?? []).filter((p) => p.active).sort((a, b) => a.min_dentists - b.min_dentists), [plans]);
  const count = Math.max(dentists ?? 0, 1);
  const quote = useMemo(() => subscriptionQuote(activePlans, count, cycle), [activePlans, count, cycle]);
  const yearlyQuote = useMemo(() => subscriptionQuote(activePlans, count, "yearly"), [activePlans, count]);

  if (!cabinet || !plans) return <PageSpinner />;

  const view = subscriptionView(cabinet);
  const tz = cabinet.timezone;
  const date = (d: Date | string | null) => formatDate(d, locale, tz);

  async function finished(status: string) {
    if (status === "succeeded") {
      await engine?.sync();
      await loadHistory();
    } else {
      void loadHistory();
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(320px,420px)]">
      <div className="flex min-w-0 flex-col gap-4">
        {/* Statut */}
        <Card>
          <CardBody className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[view.effective]}>{t(`subscription.status.${view.effective}`)}</Badge>
              {view.effective === "trialing" && view.trialDaysLeft != null && (
                <span className="text-sm font-medium">{t("subscription.trialDaysLeft", { count: view.trialDaysLeft })}</span>
              )}
            </div>
            <div className="text-sm text-muted">
              {view.effective === "trialing" && cabinet.trial_ends_at && <p>{t("subscription.trialEndsOn", { date: date(cabinet.trial_ends_at) })}</p>}
              {view.effective === "active" && view.periodEnd && <p>{t("subscription.periodEndsOn", { date: date(view.periodEnd) })}</p>}
              {view.effective === "past_due" && view.graceEnd && <p className="text-warning">{t("subscription.graceUntil", { date: date(view.graceEnd) })}</p>}
              {view.effective === "expired" && (
                <p>
                  {cabinet.current_period_end
                    ? t("subscription.expiredSince", { date: date(cabinet.current_period_end) })
                    : t("subscription.trialEnded")}
                </p>
              )}
            </div>
            {view.effective === "active" && view.renewSoon && view.daysLeft != null && (
              <p className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                <AlertTriangle className="size-4 shrink-0" />
                {t("subscription.renewSoon", { count: view.daysLeft })}
              </p>
            )}
            {!view.writable && (
              <p className="flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                <Lock className="size-4 shrink-0" />
                {t("subscription.readOnlyNow")}
              </p>
            )}
          </CardBody>
        </Card>

        {/* Formule */}
        <Card>
          <CardHeader title={t("subscription.currentPlan")} />
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Users className="size-5" />
              </div>
              <div>
                <div className="text-sm text-muted">{t("subscription.activeDentists")}</div>
                <div className="text-xl font-semibold">{dentists ?? 0}</div>
              </div>
            </div>
            <p className="text-xs text-muted">{t("subscription.activeDentistsHint")}</p>
            {activePlans.length === 0 || !quote ? (
              <p className="text-sm text-danger">{t("subscription.noPlan")}</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                {activePlans.map((p) => {
                  const current = quote.plan.id === p.id;
                  return (
                    <div
                      key={p.id}
                      className={cn("rounded-lg border p-3 text-sm", current ? "border-primary bg-primary-soft" : "border-border")}
                      aria-current={current ? "true" : undefined}
                    >
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-xs text-muted">
                        {p.max_dentists == null
                          ? t("subscription.planRangeOpen", { min: p.min_dentists })
                          : p.max_dentists === p.min_dentists
                            ? t("subscription.planSingle", { count: p.min_dentists })
                            : t("subscription.planRange", { min: p.min_dentists, max: p.max_dentists })}
                      </div>
                      <div className="mt-2 font-medium">
                        {formatGNF(p.price_monthly_gnf, locale)} <span className="text-xs text-muted">{t("subscription.perMonth")}</span>
                      </div>
                      {p.price_per_extra_dentist_gnf > 0 && (
                        <div className="text-xs text-muted">
                          {t("subscription.extraDentist", { price: formatGNF(p.price_per_extra_dentist_gnf, locale), min: p.min_dentists })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <Info className="size-3.5" />
              {t("subscription.provisionalPrices")}
            </p>
          </CardBody>
        </Card>

        {/* Historique */}
        <Card>
          <CardHeader title={t("subscription.historyTitle")} />
          {historyError && !history ? (
            <CardBody className="text-sm text-muted">{t("subscription.historyOffline")}</CardBody>
          ) : !history ? (
            <PageSpinner />
          ) : history.payments.length === 0 ? (
            <CardBody className="text-sm text-muted">{t("subscription.historyEmpty")}</CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {history.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {date(p.period_start)} → {date(p.period_end)}
                    </div>
                    <div className="text-xs text-muted">
                      {t("subscription.date")} : {date(p.created_at)} · {t(`subscription.${p.cycle}`)} · {t("subscription.dentistsCount")} :{" "}
                      {p.dentist_count}
                    </div>
                  </div>
                  <div className="whitespace-nowrap font-semibold">{formatGNF(p.amount_gnf, locale)}</div>
                </li>
              ))}
            </ul>
          )}
          {history && history.attempts.length > 0 && (
            <div className="border-t border-border px-4 py-3">
              <h3 className="mb-2 text-sm font-medium">{t("subscription.attemptsTitle")}</h3>
              <ul className="flex flex-col gap-1.5 text-sm">
                {history.attempts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted">
                      {formatDateTime(a.created_at, locale, tz)} · {t(`subscription.payment.${a.provider}`)}
                    </span>
                    <span className="flex items-center gap-2">
                      {formatGNF(a.amount_gnf, locale)}
                      <Badge tone={a.status === "pending" ? "info" : "danger"}>{t(`subscription.payment.${a.status}`)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* Lecture seule */}
        <Card>
          <CardBody className="flex gap-3">
            <Lock className="mt-0.5 size-5 shrink-0 text-muted" />
            <div className="flex flex-col gap-1 text-sm">
              <p className="font-medium">{t("subscription.readOnlyTitle")}</p>
              <p className="text-muted">{t("subscription.readOnlyText")}</p>
              <p className="text-muted">{t("subscription.graceText")}</p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Paiement (en tête sur mobile) */}
      <div className="order-first flex flex-col gap-4 lg:order-none">
        <Card className="lg:sticky lg:top-18">
          <CardHeader title={t("subscription.payTitle")} />
          <CardBody className="flex flex-col gap-4">
            <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-lg bg-background p-1">
              {(["monthly", "yearly"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={cycle === c}
                  onClick={() => {
                    setCycle(c);
                    setPayKey((k) => k + 1);
                  }}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium",
                    cycle === c ? "bg-surface text-primary shadow-sm" : "text-muted hover:text-text",
                  )}
                >
                  {t(`subscription.${c}`)}
                  {c === "yearly" && yearlyQuote && yearlyQuote.plan.yearly_discount_pct > 0 && (
                    <Badge tone="accent">{t("subscription.yearlyDiscount", { pct: yearlyQuote.plan.yearly_discount_pct })}</Badge>
                  )}
                </button>
              ))}
            </div>

            {quote ? (
              <>
                <div>
                  <div className="text-sm text-muted">
                    {quote.plan.name} · {t("subscription.activeDentists").toLowerCase()} : {count}
                  </div>
                  <div className="text-2xl font-semibold">
                    {formatGNF(quote.amount, locale)}{" "}
                    <span className="text-sm font-normal text-muted">{t(cycle === "yearly" ? "subscription.perYear" : "subscription.perMonth")}</span>
                  </div>
                  {quote.yearlySaving > 0 && (
                    <div className="text-sm text-success">{t("subscription.yearlySaving", { amount: formatGNF(quote.yearlySaving, locale) })}</div>
                  )}
                </div>
                <p className="text-xs text-muted">{t("subscription.payInfo")}</p>
                <MobilePayment
                  key={payKey}
                  request={{ purpose: "subscription", cabinet_id: cabinet.id, cycle, amount_gnf: quote.amount, return_path: "/app/abonnement" }}
                  amountLabel={formatGNF(quote.amount, locale)}
                  defaultPhone={cabinet.phone}
                  resumeId={payKey === 0 ? resumeId : null}
                  onFinished={(s) => void finished(s)}
                />
              </>
            ) : (
              <p className="text-sm text-danger">{t("subscription.noPlan")}</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
