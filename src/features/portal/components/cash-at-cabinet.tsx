"use client";

import { Banknote, Clock, MapPin, Phone } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { todayISO } from "@/lib/dates";
import { formatGNF, formatPhone } from "@/lib/format";
import { hasOpeningHours, isoWeekday, weekRows } from "@/features/portal/lib/schedule";
import type { OpeningHours, PortalCabinet } from "@/features/portal/lib/types";

/** « Payer en espèces au cabinet » : montant, coordonnées, horaires et numéro de facture à présenter. */
export function CashAtCabinet({
  amount,
  number,
  cabinet,
  hours,
}: {
  amount: number;
  number: string | null;
  cabinet: PortalCabinet | undefined;
  hours: OpeningHours | undefined;
}) {
  const { t, locale } = useI18n();
  const address = [cabinet?.address, cabinet?.city].filter(Boolean).join(", ");
  const today = cabinet ? isoWeekday(todayISO(cabinet.timezone)) : null;
  const known = hours && hasOpeningHours(hours) ? hours : null;
  const todayRow = known && today ? weekRows(known).find((r) => r.day === today) : null;

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-primary-soft/40 p-3 text-sm" data-testid="cash-at-cabinet">
      <h3 className="flex items-center gap-2 font-semibold">
        <Banknote className="size-5 text-primary" aria-hidden />
        {t("portal.cash.title")}
      </h3>
      <p>{t("portal.cash.amount", { amount: formatGNF(amount, locale) })}</p>
      {number && (
        <p>
          {t("portal.cash.present")} <strong className="whitespace-nowrap font-mono">{number}</strong>
        </p>
      )}
      {cabinet && (
        <ul className="flex flex-col gap-1 text-muted">
          <li className="font-medium text-text">{cabinet.name}</li>
          {address && (
            <li className="flex items-start gap-1.5">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
              {address}
            </li>
          )}
          {cabinet.phone && (
            <li className="flex items-center gap-1.5">
              <Phone className="size-4 shrink-0" aria-hidden />
              <a href={`tel:${cabinet.phone}`} className="text-primary underline">
                {formatPhone(cabinet.phone)}
              </a>
            </li>
          )}
          {known && (
            <li className="flex items-start gap-1.5">
              <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
              <details>
                <summary className="cursor-pointer">
                  {t("portal.cash.today")} :{" "}
                  {todayRow && todayRow.intervals.length
                    ? todayRow.intervals.map(([a, b]) => `${a}–${b}`).join(", ")
                    : t("portal.public.closed")}
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {weekRows(known).map((r) => (
                    <li key={r.day} className="flex justify-between gap-3">
                      <span>{t(`portal.days.d${r.day}`)}</span>
                      <span>{r.intervals.length ? r.intervals.map(([a, b]) => `${a}–${b}`).join(", ") : t("portal.public.closed")}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
