"use client";

import type { KeyboardEvent } from "react";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/components/ui/cn";
import {
  coloredSurfaces,
  isUpper,
  quadrants,
  STATUS_STYLE,
  surfaceLayout,
  TOOTH_STATUSES,
  type Dentition,
  type Surface,
  type ToothStatus,
} from "../lib/fdi";

export type ToothState = { status: ToothStatus; surfaces: string[]; notes?: string | null };

const CELL = 48;
const BOX = 40;
const INNER = 12; // marge de la face occlusale dans le carré
const HEIGHT = 72;

/** Polygones des 5 zones d'une dent (carré de BOX px, origine 0,0). */
const ZONES: Record<"top" | "bottom" | "left" | "right" | "center", string> = {
  top: `0,0 ${BOX},0 ${BOX - INNER},${INNER} ${INNER},${INNER}`,
  bottom: `0,${BOX} ${BOX},${BOX} ${BOX - INNER},${BOX - INNER} ${INNER},${BOX - INNER}`,
  left: `0,0 ${INNER},${INNER} ${INNER},${BOX - INNER} 0,${BOX}`,
  right: `${BOX},0 ${BOX - INNER},${INNER} ${BOX - INNER},${BOX - INNER} ${BOX},${BOX}`,
  center: `${INNER},${INNER} ${BOX - INNER},${INNER} ${BOX - INNER},${BOX - INNER} ${INNER},${BOX - INNER}`,
};

function ToothGlyph({
  tooth,
  x,
  state,
  planned,
  selected,
  onSelect,
  label,
}: {
  tooth: number;
  x: number;
  state: ToothState | undefined;
  planned: boolean;
  selected: boolean;
  onSelect: (tooth: number) => void;
  label: string;
}) {
  const status = state?.status ?? "healthy";
  const style = STATUS_STYLE[status];
  const colored = new Set<Surface>(coloredSurfaces(status, state?.surfaces ?? []));
  const layout = surfaceLayout(tooth);
  const upper = isUpper(tooth);
  const boxY = upper ? 20 : 8;
  const numberY = upper ? 13 : HEIGHT - 8;
  const markerY = upper ? HEIGHT - 6 : 4;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(tooth);
    }
  };

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => onSelect(tooth)}
      onKeyDown={onKey}
      className="cursor-pointer outline-none [&:focus-visible>rect.focus]:stroke-primary"
    >
      <rect className="focus fill-transparent stroke-transparent" x={x + 1} y={1} width={CELL - 2} height={HEIGHT - 2} rx={6} strokeWidth={2} />
      <text
        x={x + CELL / 2}
        y={numberY}
        textAnchor="middle"
        className={cn("text-[12px] font-semibold", selected ? "fill-primary" : "fill-text")}
      >
        {tooth}
      </text>
      <g transform={`translate(${x + (CELL - BOX) / 2}, ${boxY})`}>
        {(Object.keys(ZONES) as (keyof typeof ZONES)[]).map((zone) => {
          const surface = layout[zone];
          return (
            <polygon
              key={zone}
              points={ZONES[zone]}
              className={cn(colored.has(surface) ? style.fill : "fill-surface", "stroke-muted")}
              strokeWidth={1}
              strokeLinejoin="round"
            />
          );
        })}
        {style.cross && (
          <g className={style.cross === "danger" ? "stroke-danger" : "stroke-muted"} strokeWidth={3} strokeLinecap="round">
            <line x1={3} y1={3} x2={BOX - 3} y2={BOX - 3} />
            <line x1={BOX - 3} y1={3} x2={3} y2={BOX - 3} />
          </g>
        )}
        {selected && <rect x={-3} y={-3} width={BOX + 6} height={BOX + 6} rx={4} className="fill-none stroke-primary" strokeWidth={3} />}
      </g>
      {planned && <circle cx={x + CELL / 2} cy={markerY} r={3.5} className="fill-primary" />}
    </g>
  );
}

/**
 * Schéma dentaire FDI interactif. Quatre quadrants (haut droite, haut gauche, bas droite, bas gauche) :
 * empilés sur mobile (dents assez grandes pour le doigt), en croix sur grand écran.
 */
export function DentalChart({
  dentition,
  states,
  planned,
  selected,
  onSelect,
}: {
  dentition: Dentition;
  states: ReadonlyMap<number, ToothState>;
  planned: ReadonlySet<number>;
  selected: number | null;
  onSelect: (tooth: number) => void;
}) {
  const t = useT();
  const qs = quadrants(dentition);

  return (
    <div className="grid gap-x-0 gap-y-3 sm:grid-cols-2">
      {qs.map((q, i) => {
        const width = q.teeth.length * CELL;
        return (
          <figure
            key={q.quadrant}
            className={cn(
              "flex flex-col",
              i % 2 === 0 ? "sm:items-end sm:border-r-2 sm:border-dashed sm:border-border sm:pr-2" : "sm:items-start sm:pl-2",
              i < 2 ? "sm:border-b-2 sm:border-dashed sm:pb-2" : "sm:pt-1",
              i < 2 && "sm:border-b-border",
            )}
          >
            <figcaption className={cn("mb-1 text-xs font-medium text-muted", i % 2 === 0 ? "sm:text-right" : "")}>
              {t(q.labelKey)} ({q.quadrant})
            </figcaption>
            <svg
              viewBox={`0 0 ${width} ${HEIGHT}`}
              className="h-auto w-full"
              style={{ maxWidth: q.teeth.length * 64 }}
              role="group"
              aria-label={`${t(q.labelKey)} (${q.quadrant})`}
            >
              {q.teeth.map((tooth, idx) => {
                const st = states.get(tooth);
                const status = st?.status ?? "healthy";
                const faces = st?.surfaces?.length ? ` (${st.surfaces.join(", ")})` : "";
                const label = `${t("patients.chart.tooth", { n: tooth })} : ${t(`patients.toothStatus.${status}`)}${faces}${
                  planned.has(tooth) ? ` · ${t("patients.chart.planned")}` : ""
                }`;
                return (
                  <ToothGlyph
                    key={tooth}
                    tooth={tooth}
                    x={idx * CELL}
                    state={st}
                    planned={planned.has(tooth)}
                    selected={selected === tooth}
                    onSelect={onSelect}
                    label={label}
                  />
                );
              })}
            </svg>
          </figure>
        );
      })}
    </div>
  );
}

/** Légende des couleurs du schéma. */
export function ChartLegend() {
  const t = useT();
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{t("patients.chart.legend")}</p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3 lg:grid-cols-4">
        {TOOTH_STATUSES.map((s) => (
          <li key={s} className="flex items-center gap-2">
            <StatusSwatch status={s} />
            {t(`patients.toothStatus.${s}`)}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="flex size-4 items-center justify-center">
            <span className="size-2 rounded-full bg-primary" />
          </span>
          {t("patients.chart.planned")}
        </li>
      </ul>
    </div>
  );
}

export function StatusSwatch({ status, className }: { status: ToothStatus; className?: string }) {
  const style = STATUS_STYLE[status];
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0", className)} aria-hidden>
      <rect x={0.5} y={0.5} width={15} height={15} rx={2} className={cn(style.fill, "stroke-muted")} />
      {style.cross && (
        <g className={style.cross === "danger" ? "stroke-danger" : "stroke-muted"} strokeWidth={2} strokeLinecap="round">
          <line x1={3} y1={3} x2={13} y2={13} />
          <line x1={13} y1={3} x2={3} y2={13} />
        </g>
      )}
    </svg>
  );
}
