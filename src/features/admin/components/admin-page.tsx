"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarPlus, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { supabase } from "@/lib/supabase/client";
import { formatDate, formatGNF, parseGNF } from "@/lib/format";
import { cyclePrice, planFor } from "@/lib/payments/pricing";
import type { Database, Tables } from "@/lib/database.types";
import { Card, CardBody, PageHeader, PageSpinner } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { Badge, type Tone } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Table, Td, Th } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";

type AdminCabinet = Database["public"]["Functions"]["admin_cabinets"]["Returns"][number];
type Plan = Tables<"plans">;
type Status = Database["public"]["Enums"]["subscription_status"];
type Metrics = {
  cabinets: number;
  active: number;
  trialing: number;
  past_due: number;
  expired: number;
  revenue_month_gnf: number;
  active_dentists: number;
};

const STATUSES: Status[] = ["trialing", "active", "past_due", "expired", "cancelled"];
const TONE: Record<Status, Tone> = { trialing: "info", active: "success", past_due: "warning", expired: "danger", cancelled: "neutral" };
const DAY = 86_400_000;

/** Statut effectif (un essai dépassé est affiché comme expiré). */
function effective(c: AdminCabinet): Status {
  if (c.subscription_status === "trialing" && c.trial_ends_at && new Date(c.trial_ends_at).getTime() <= Date.now()) return "expired";
  return c.subscription_status;
}

/** Accès réservé aux admins plateforme, en ligne, hors de /app. */
export function AdminGate({ children }: { children: ReactNode }) {
  const { ready, user } = useAuth();
  const { ready: cabReady, isPlatformAdmin } = useCabinet();
  const { t } = useI18n();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) router.replace("/connexion?next=%2Fadmin");
  }, [ready, user, router]);

  if (!ready || !user || !cabReady) return <PageSpinner />;
  if (!isPlatformAdmin) {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-muted">{t("admin.notAdmin")}</p>
        <Link href="/app" className="text-primary hover:underline">
          {t("admin.backToApp")}
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}

export function AdminPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"cabinets" | "plans">("cabinets");
  const [cabinets, setCabinets] = useState<AdminCabinet[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!navigator.onLine) return setError(t("admin.offline"));
    setLoading(true);
    const sb = supabase();
    const [c, m, p] = await Promise.all([
      sb.rpc("admin_cabinets"),
      sb.rpc("admin_metrics"),
      sb.from("plans").select("*").order("sort_order").order("min_dentists"),
    ]);
    setLoading(false);
    if (c.error || m.error || p.error) return setError(t("admin.loadError"));
    setError(null);
    setCabinets(c.data);
    setMetrics(m.data as unknown as Metrics);
    setPlans(p.data);
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial depuis le serveur
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6">
      <Link href="/app" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" />
        {t("admin.backToApp")}
      </Link>
      <PageHeader
        title={t("admin.title")}
        subtitle={t("admin.subtitle")}
        actions={
          <Button variant="secondary" onClick={() => void load()} loading={loading} aria-label="Actualiser">
            <RefreshCw className="size-4" />
          </Button>
        }
      />
      {error && <p className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {metrics && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label={t("admin.metrics.active")} value={metrics.active} tone="text-success" />
          <Metric label={t("admin.metrics.trialing")} value={metrics.trialing} tone="text-info" />
          <Metric label={t("admin.metrics.pastDue")} value={metrics.past_due} tone="text-warning" />
          <Metric label={t("admin.metrics.expired")} value={metrics.expired} tone="text-danger" />
          <Metric label={t("admin.metrics.dentists")} value={metrics.active_dentists} />
          <Metric label={t("admin.metrics.revenueMonth")} value={formatGNF(metrics.revenue_month_gnf)} />
        </div>
      )}

      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "cabinets", label: t("admin.tabs.cabinets") },
            { value: "plans", label: t("admin.tabs.plans") },
          ]}
        />
      </div>

      {tab === "cabinets" ? (
        cabinets ? (
          <CabinetsTable cabinets={cabinets} onChanged={load} />
        ) : (
          !error && <PageSpinner />
        )
      ) : plans ? (
        <PlansEditor plans={plans} onChanged={load} />
      ) : (
        !error && <PageSpinner />
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <Card>
      <CardBody className="p-3">
        <div className="text-xs text-muted">{label}</div>
        <div className={`mt-1 text-lg font-semibold ${tone ?? ""}`}>{value}</div>
      </CardBody>
    </Card>
  );
}

function CabinetsTable({ cabinets, onChanged }: { cabinets: AdminCabinet[]; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const [extend, setExtend] = useState<AdminCabinet | null>(null);
  const [status, setStatus] = useState<AdminCabinet | null>(null);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? cabinets.filter((c) => [c.name, c.slug, c.city, c.email, c.phone].some((v) => v?.toLowerCase().includes(s))) : cabinets;
  }, [cabinets, q]);
  const d = (v: string | null) => (v ? formatDate(v, locale) : "—");

  return (
    <Card>
      <div className="border-b border-border p-3">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.cabinets.search")} className="pl-9" aria-label={t("admin.cabinets.search")} />
        </div>
      </div>
      {list.length === 0 ? (
        <p className="p-4 text-sm text-muted">{t("admin.cabinets.empty")}</p>
      ) : (
        <>
        {/* Mobile : liste */}
        <ul className="divide-y divide-border md:hidden">
          {list.map((c) => {
            const s = effective(c);
            return (
              <li key={c.id} className="flex flex-col gap-1.5 px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="truncate text-xs text-muted">
                      {c.slug}
                      {c.plan_code ? ` · ${c.plan_code}` : ""}
                    </div>
                  </div>
                  <Badge tone={TONE[s]}>{t(`subscription.status.${s}`)}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-xs text-muted">
                  <span>
                    {t("admin.cabinets.dentists")} : {c.active_dentists}
                  </span>
                  <span>
                    {t("admin.cabinets.trialEnd")} : {d(c.trial_ends_at)}
                  </span>
                  <span>
                    {t("admin.cabinets.periodEnd")} : {d(c.current_period_end)}
                  </span>
                  <span>
                    {t("admin.cabinets.lastPayment")} : {c.last_payment_at ? `${d(c.last_payment_at)} (${formatGNF(c.last_payment_gnf, locale)})` : "—"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setExtend(c)}>
                    <CalendarPlus className="size-4" />
                    {t("admin.cabinets.extendTrial")}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setStatus(c)}>
                    <SlidersHorizontal className="size-4" />
                    {t("admin.cabinets.changeStatus")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="hidden md:block">
        <Table>
          <thead>
            <tr>
              <Th>{t("admin.cabinets.name")}</Th>
              <Th>{t("admin.cabinets.status")}</Th>
              <Th className="text-right">{t("admin.cabinets.dentists")}</Th>
              <Th>{t("admin.cabinets.trialEnd")}</Th>
              <Th>{t("admin.cabinets.periodEnd")}</Th>
              <Th>{t("admin.cabinets.lastPayment")}</Th>
              <Th>
                <span className="sr-only">{t("common.actions")}</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const s = effective(c);
              return (
                <tr key={c.id}>
                  <Td>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted">
                      {c.slug}
                      {c.city ? ` · ${c.city}` : ""}
                      {c.plan_code ? ` · ${c.plan_code}` : ""}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={TONE[s]}>{t(`subscription.status.${s}`)}</Badge>
                  </Td>
                  <Td className="text-right">{c.active_dentists}</Td>
                  <Td className="whitespace-nowrap">{d(c.trial_ends_at)}</Td>
                  <Td className="whitespace-nowrap">{d(c.current_period_end)}</Td>
                  <Td className="whitespace-nowrap">
                    {c.last_payment_at ? (
                      <>
                        {d(c.last_payment_at)}
                        <div className="text-xs text-muted">{formatGNF(c.last_payment_gnf, locale)}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setExtend(c)} title={t("admin.cabinets.extendTrial")} aria-label={t("admin.cabinets.extendTrial")}>
                        <CalendarPlus className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setStatus(c)} title={t("admin.cabinets.changeStatus")} aria-label={t("admin.cabinets.changeStatus")}>
                        <SlidersHorizontal className="size-4" />
                      </Button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        </div>
        </>
      )}
      {extend && <ExtendTrialDialog cabinet={extend} onClose={() => setExtend(null)} onDone={onChanged} />}
      {status && <StatusDialog cabinet={status} onClose={() => setStatus(null)} onDone={onChanged} />}
    </Card>
  );
}

function ExtendTrialDialog({ cabinet, onClose, onDone }: { cabinet: AdminCabinet; onClose: () => void; onDone: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const n = Math.max(0, Math.min(365, Math.round(Number(days) || 0)));
  const base = Math.max(now, cabinet.trial_ends_at ? new Date(cabinet.trial_ends_at).getTime() : now);
  const newEnd = new Date(base + n * DAY);

  async function save() {
    setBusy(true);
    const patch: { trial_ends_at: string; subscription_status?: Status } = { trial_ends_at: newEnd.toISOString() };
    if (cabinet.subscription_status === "expired" || cabinet.subscription_status === "trialing") patch.subscription_status = "trialing";
    const { error } = await supabase().from("cabinets").update(patch).eq("id", cabinet.id);
    setBusy(false);
    if (error) return toast(t("common.error"), "error");
    toast(t("admin.cabinets.updated"));
    onDone();
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${t("admin.cabinets.extendTrial")} · ${cabinet.name}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={n === 0}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("admin.cabinets.days")}>
          {(p) => <Input {...p} type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />}
        </Field>
        <p className="text-sm">{t("admin.cabinets.newEnd", { date: formatDate(newEnd, locale) })}</p>
        <p className="text-xs text-muted">{t("admin.cabinets.extendInfo")}</p>
      </div>
    </Dialog>
  );
}

function StatusDialog({ cabinet, onClose, onDone }: { cabinet: AdminCabinet; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<Status>(cabinet.subscription_status);
  const [periodEnd, setPeriodEnd] = useState(cabinet.current_period_end ? cabinet.current_period_end.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { error } = await supabase()
      .from("cabinets")
      .update({
        subscription_status: status,
        // Fin de journée à Conakry (UTC+0).
        current_period_end: periodEnd ? new Date(`${periodEnd}T23:59:59Z`).toISOString() : null,
      })
      .eq("id", cabinet.id);
    setBusy(false);
    if (error) return toast(t("common.error"), "error");
    toast(t("admin.cabinets.updated"));
    onDone();
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${t("admin.cabinets.changeStatus")} · ${cabinet.name}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("admin.cabinets.statusLabel")}>
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`subscription.status.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.cabinets.periodEndLabel")}>
          {(p) => <Input {...p} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />}
        </Field>
        <p className="text-xs text-muted">{t("admin.cabinets.statusInfo")}</p>
      </div>
    </Dialog>
  );
}

function PlansEditor({ plans, onChanged }: { plans: Plan[]; onChanged: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{t("admin.plans.provisional")}</p>
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} plans={plans} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

function PlanCard({ plan, plans, onChanged }: { plan: Plan; plans: Plan[]; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [name, setName] = useState(plan.name);
  const [min, setMin] = useState(String(plan.min_dentists));
  const [max, setMax] = useState(plan.max_dentists == null ? "" : String(plan.max_dentists));
  const [price, setPrice] = useState(String(plan.price_monthly_gnf));
  const [extra, setExtra] = useState(String(plan.price_per_extra_dentist_gnf));
  const [discount, setDiscount] = useState(String(plan.yearly_discount_pct));
  const [active, setActive] = useState(plan.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = {
    ...plan,
    name,
    min_dentists: Number(min),
    max_dentists: max.trim() === "" ? null : Number(max),
    price_monthly_gnf: parseGNF(price) ?? NaN,
    price_per_extra_dentist_gnf: parseGNF(extra) ?? NaN,
    yearly_discount_pct: Number(discount),
    active,
  };
  const valid =
    name.trim() !== "" &&
    Number.isInteger(draft.min_dentists) &&
    draft.min_dentists >= 1 &&
    (draft.max_dentists == null || (Number.isInteger(draft.max_dentists) && draft.max_dentists >= draft.min_dentists)) &&
    Number.isFinite(draft.price_monthly_gnf) &&
    Number.isFinite(draft.price_per_extra_dentist_gnf) &&
    Number.isInteger(draft.yearly_discount_pct) &&
    draft.yearly_discount_pct >= 0 &&
    draft.yearly_discount_pct <= 100;

  const examples = valid
    ? [draft.min_dentists, draft.max_dentists ?? draft.min_dentists + 2]
        .filter((n, i, a) => a.indexOf(n) === i)
        .map((n) => {
          const all = plans.map((p) => (p.id === plan.id ? draft : p));
          const pl = planFor(all, n);
          return pl?.id === plan.id ? `${n} → ${formatGNF(cyclePrice(draft, n, "monthly"), locale)} / ${formatGNF(cyclePrice(draft, n, "yearly"), locale)}` : null;
        })
        .filter(Boolean)
        .join(" ; ")
    : "";

  async function save() {
    if (!valid) return setError(t("admin.plans.invalid"));
    setError(null);
    setBusy(true);
    const { error: e } = await supabase()
      .from("plans")
      .update({
        name: name.trim(),
        min_dentists: draft.min_dentists,
        max_dentists: draft.max_dentists,
        price_monthly_gnf: draft.price_monthly_gnf,
        price_per_extra_dentist_gnf: draft.price_per_extra_dentist_gnf,
        yearly_discount_pct: draft.yearly_discount_pct,
        active,
      })
      .eq("id", plan.id);
    setBusy(false);
    if (e) return setError(t("common.error"));
    toast(t("admin.plans.saved"));
    onChanged();
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase text-muted">
            {t("admin.plans.code")} : {plan.code}
          </span>
          <Checkbox label={t("admin.plans.active")} checked={active} onChange={(e) => setActive(e.target.checked)} />
        </div>
        <Field label={t("admin.plans.name")}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("admin.plans.minDentists")}>
            {(p) => <Input {...p} type="number" min={1} value={min} onChange={(e) => setMin(e.target.value)} />}
          </Field>
          <Field label={t("admin.plans.maxDentists")} hint={t("admin.plans.maxHint")}>
            {(p) => <Input {...p} type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} />}
          </Field>
        </div>
        <Field label={t("admin.plans.price")}>
          {(p) => <Input {...p} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />}
        </Field>
        <Field label={t("admin.plans.extra")}>
          {(p) => <Input {...p} inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value)} />}
        </Field>
        <Field label={t("admin.plans.discount")}>
          {(p) => <Input {...p} type="number" min={0} max={100} value={discount} onChange={(e) => setDiscount(e.target.value)} />}
        </Field>
        {examples && <p className="text-xs text-muted">{t("admin.plans.preview", { examples })}</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button onClick={() => void save()} loading={busy} className="self-start">
          {t("admin.plans.save")}
        </Button>
      </CardBody>
    </Card>
  );
}
