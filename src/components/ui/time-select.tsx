"use client";

import { useT } from "@/components/i18n-provider";
import { cn } from "./cn";

/** Pas des heures proposées (minutes). */
export const TIME_STEP = 5;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Choix d'une heure « HH:MM » par pas de 5 minutes : une liste des heures et une liste
 * des minutes (00, 05, 10…). Une valeur existante hors pas (ex. 09:07) reste affichée.
 */
export function TimeSelect({
  id,
  value,
  onChange,
  disabled,
  step = TIME_STEP,
  className,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  step?: number;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  required?: boolean;
}) {
  const t = useT();
  const hourLabel = t("common.hours");
  const minuteLabel = t("common.minutes");
  const [h, m] = (value || "00:00").split(":").map((x) => Number(x) || 0);
  const minutes: number[] = [];
  for (let x = 0; x < 60; x += step) minutes.push(x);
  if (!minutes.includes(m)) {
    minutes.push(m);
    minutes.sort((a, b) => a - b);
  }
  const control =
    "h-10 appearance-none rounded-lg border border-border bg-surface px-2 text-center text-sm tabular-nums text-text " +
    "focus:outline-2 focus:outline-offset-0 focus:outline-primary disabled:opacity-60 aria-[invalid=true]:border-danger";
  return (
    <span className={cn("inline-flex items-center gap-1", className)} role="group" aria-label={ariaLabel}>
      <select
        id={id}
        aria-label={ariaLabel ? `${ariaLabel} (${hourLabel})` : hourLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        value={h}
        onChange={(e) => onChange(`${pad(Number(e.target.value))}:${pad(m)}`)}
        className={cn(control, "w-16")}
      >
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={i}>
            {pad(i)}
          </option>
        ))}
      </select>
      <span aria-hidden className="text-muted">
        :
      </span>
      <select
        aria-label={ariaLabel ? `${ariaLabel} (${minuteLabel})` : minuteLabel}
        aria-invalid={ariaInvalid}
        disabled={disabled}
        value={m}
        onChange={(e) => onChange(`${pad(h)}:${pad(Number(e.target.value))}`)}
        className={cn(control, "w-16")}
      >
        {minutes.map((x) => (
          <option key={x} value={x}>
            {pad(x)}
          </option>
        ))}
      </select>
    </span>
  );
}
