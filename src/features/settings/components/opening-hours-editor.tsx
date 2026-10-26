"use client";

import { Copy, Plus, X } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { TimeSelect } from "@/components/ui/time-select";
import { rangesValid, WEEKDAYS, type OpeningHours, type Range } from "../opening-hours";

/** Éditeur des horaires : pour chaque jour, zéro (fermé) ou plusieurs plages horaires. */
export function OpeningHoursEditor({
  value,
  onChange,
  disabled,
}: {
  value: OpeningHours;
  onChange: (v: OpeningHours) => void;
  disabled?: boolean;
}) {
  const t = useT();

  const setDay = (day: string, ranges: Range[]) => onChange({ ...value, [day]: ranges });

  const copyToWorkingDays = (day: string) => {
    const src = value[day] ?? [];
    const next = { ...value };
    for (const d of WEEKDAYS) if (Number(d) <= 5) next[d] = src.map((r) => [r[0], r[1]] as Range);
    onChange(next);
  };

  return (
    <div className="flex flex-col divide-y divide-border">
      {WEEKDAYS.map((day) => {
        const ranges = value[day] ?? [];
        const invalid = ranges.length > 0 && !rangesValid(ranges);
        return (
          <div key={day} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
            <div className="flex w-full items-center justify-between sm:w-32 sm:pt-2">
              <span className="text-sm font-medium">{t(`settings.days.${day}`)}</span>
              {ranges.length === 0 && <span className="text-xs text-muted sm:hidden">{t("settings.cabinet.closed")}</span>}
            </div>
            <div className="flex flex-1 flex-col gap-2">
              {ranges.length === 0 && <span className="hidden pt-2 text-sm text-muted sm:block">{t("settings.cabinet.closed")}</span>}
              {ranges.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <TimeSelect
                    aria-label={`${t(`settings.days.${day}`)} ${i + 1} ${t("settings.cabinet.rangeStart")}`}
                    value={r[0]}
                    disabled={disabled}
                    aria-invalid={invalid || undefined}
                    onChange={(v) => setDay(day, ranges.map((x, j) => (j === i ? [v, x[1]] : x)))}
                  />
                  <span className="text-muted">–</span>
                  <TimeSelect
                    aria-label={`${t(`settings.days.${day}`)} ${i + 1} ${t("settings.cabinet.rangeEnd")}`}
                    value={r[1]}
                    disabled={disabled}
                    aria-invalid={invalid || undefined}
                    onChange={(v) => setDay(day, ranges.map((x, j) => (j === i ? [x[0], v] : x)))}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("settings.cabinet.removeRange")}
                    disabled={disabled}
                    onClick={() => setDay(day, ranges.filter((_, j) => j !== i))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              {invalid && <p className="text-xs text-danger">{t("settings.cabinet.rangeInvalid")}</p>}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    const last = ranges[ranges.length - 1];
                    setDay(day, [...ranges, last ? [last[1], last[1] < "18:00" ? "18:00" : "20:00"] : ["08:00", "12:00"]]);
                  }}
                >
                  <Plus className="size-4" />
                  {t("settings.cabinet.addRange")}
                </Button>
                {day === "1" && (
                  <Button variant="ghost" size="sm" disabled={disabled} onClick={() => copyToWorkingDays(day)}>
                    <Copy className="size-4" />
                    {t("settings.cabinet.copyToAll")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
