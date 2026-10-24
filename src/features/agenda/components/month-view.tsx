"use client";

import type { Row } from "@/lib/local/db";
import { useI18n } from "@/components/i18n-provider";
import { formatTime } from "@/lib/format";
import { cn } from "@/components/ui/cn";
import { isActiveStatus, localDay, viewDays } from "../lib/grid";
import { appointmentLabel, type Appointment } from "../lib/data";

export function MonthView({
  date,
  today,
  appointments,
  patients,
  types,
  timeZone,
  onDay,
  onOpen,
}: {
  date: string;
  today: string;
  appointments: Appointment[];
  patients: Map<string, Row<"patients">>;
  types: Map<string, Row<"appointment_types">>;
  timeZone: string;
  onDay: (date: string) => void;
  onOpen: (a: Appointment) => void;
}) {
  const { t, locale } = useI18n();
  const days = viewDays("month", date);
  const month = date.slice(0, 7);
  const byDay = new Map<string, Appointment[]>();
  for (const a of [...appointments].sort((x, y) => x.starts_at.localeCompare(y.starts_at))) {
    const d = localDay(a.starts_at, timeZone);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(a);
  }
  const weekdayFmt = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { weekday: "short", timeZone: "UTC" });

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border text-center text-xs font-medium uppercase text-muted">
        {days.slice(0, 7).map((d) => (
          <div key={d} className="py-2">
            {weekdayFmt.format(new Date(`${d}T00:00:00Z`))}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const active = list.filter((a) => isActiveStatus(a.status));
          return (
            <div
              key={d}
              className={cn(
                "min-h-20 border-b border-l border-border p-1 first:border-l-0 sm:min-h-28 [&:nth-child(7n+1)]:border-l-0",
                d.slice(0, 7) !== month && "bg-background text-muted",
              )}
            >
              <button
                type="button"
                onClick={() => onDay(d)}
                className={cn(
                  "mb-1 flex size-7 items-center justify-center rounded-full text-sm hover:bg-primary-soft",
                  d === today && "bg-primary font-semibold text-on-primary hover:bg-primary-hover",
                )}
                aria-label={d}
              >
                {Number(d.slice(8))}
              </button>
              {/* Téléphone : pastilles ; écran large : liste. */}
              {active.length > 0 && (
                <button type="button" onClick={() => onDay(d)} className="block w-full text-left text-[11px] font-medium text-primary sm:hidden">
                  {t("agenda.count", { count: active.length })}
                </button>
              )}
              <ul className="hidden flex-col gap-0.5 sm:flex">
                {list.slice(0, 3).map((a) => {
                  const color = a.type_id ? types.get(a.type_id)?.color : undefined;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(a)}
                        className={cn(
                          "flex w-full items-center gap-1 truncate rounded px-1 text-left text-[11px] hover:bg-primary-soft",
                          !isActiveStatus(a.status) && "line-through opacity-50",
                        )}
                      >
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color ?? "var(--text-muted)" }} />
                        <span className="text-muted">{formatTime(a.starts_at, locale, timeZone)}</span>
                        <span className="truncate">{appointmentLabel(a, patients)}</span>
                      </button>
                    </li>
                  );
                })}
                {list.length > 3 && (
                  <li>
                    <button type="button" onClick={() => onDay(d)} className="px-1 text-[11px] text-primary hover:underline">
                      {t("agenda.more", { count: list.length - 3 })}
                    </button>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
