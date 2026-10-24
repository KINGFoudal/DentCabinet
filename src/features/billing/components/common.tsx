"use client";

import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { useI18n } from "@/components/i18n-provider";
import { Badge, type Tone } from "@/components/ui/badge";
import { todayISO } from "@/lib/dates";
import { CABINET_TIMEZONE, formatDate, formatGNF } from "@/lib/format";
import type { InvoiceStatus, QuoteStatus } from "../lib/totals";
import type { InstallmentState } from "../lib/installments";

/** Contexte commun aux écrans de facturation. */
export function useBilling() {
  const cabinetId = useCabinetId();
  const { cabinet, can, readOnly } = useCabinet();
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const tz = cabinet?.timezone ?? CABINET_TIMEZONE;
  return {
    cabinetId,
    cabinet,
    can,
    readOnly,
    canWrite: can.billingWrite,
    userId: user?.id ?? null,
    t,
    locale,
    tz,
    today: todayISO(tz),
    gnf: (n: number | null | undefined) => formatGNF(n, locale),
    date: (d: string | null | undefined) => (d ? formatDate(d.length === 10 ? `${d}T12:00:00Z` : d, locale, tz) : ""),
  };
}

const invoiceTones: Record<InvoiceStatus, Tone> = {
  draft: "neutral",
  issued: "info",
  partially_paid: "warning",
  paid: "success",
  cancelled: "danger",
};

const quoteTones: Record<QuoteStatus, Tone> = {
  draft: "neutral",
  sent: "info",
  accepted: "success",
  refused: "danger",
  expired: "warning",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const { t } = useI18n();
  return <Badge tone={invoiceTones[status]}>{t(`billing.invoiceStatus.${status}`)}</Badge>;
}

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const { t } = useI18n();
  return <Badge tone={quoteTones[status]}>{t(`billing.quoteStatus.${status}`)}</Badge>;
}

const installmentTones: Record<InstallmentState, Tone> = { paid: "success", partial: "warning", overdue: "danger", upcoming: "neutral" };

export function InstallmentBadge({ state }: { state: InstallmentState }) {
  const { t } = useI18n();
  return <Badge tone={installmentTones[state]}>{t(`billing.installments.state.${state}`)}</Badge>;
}

/** Mention « provisoire » (chiffres ou numéro pas encore confirmés par le serveur). */
export function ProvisionalBadge({ show }: { show: boolean }) {
  const { t } = useI18n();
  if (!show) return null;
  return (
    <span title={t("billing.provisionalHint")} className="text-xs font-normal italic text-warning">
      {t("billing.provisional")}
    </span>
  );
}

/** Numéro du document, « provisoire » si émis mais pas encore numéroté, « brouillon » sinon. */
export function DocNumber({ number, status }: { number: string | null; status: string }) {
  const { t } = useI18n();
  if (number) return <>{number}</>;
  if (status === "draft") return <span className="text-muted">{t("billing.draftNumber")}</span>;
  return <span className="italic text-warning">{t("billing.provisionalNumber")}</span>;
}

export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "success" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 sm:p-4">
      <div className="text-xs text-muted sm:text-sm">{label}</div>
      <div className={`mt-1 text-lg font-semibold sm:text-xl ${tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : ""}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}
