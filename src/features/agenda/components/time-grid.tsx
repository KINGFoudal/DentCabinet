"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Row } from "@/lib/local/db";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/components/ui/cn";
import {
  applyDrag,
  isActiveStatus,
  isoToMinutes,
  layoutLanes,
  minutesToHHMM,
  pxToMinutes,
  snap,
  unavailableIntervals,
  type AvailabilityCtx,
  type DragMode,
} from "../lib/grid";
import { appointmentLabel, type Appointment } from "../lib/data";

export type GridColumn = {
  key: string;
  label: ReactNode;
  date: string;
  /** Praticien utilisé pour griser les heures (null = heures du cabinet). */
  availabilityDentist: string | null;
  highlight?: boolean;
};

type DragState = {
  id: string;
  mode: DragMode;
  pointerId: number;
  pointerType: string;
  x0: number;
  y0: number;
  col0: string;
  start0: number;
  end0: number;
  col: string;
  start: number;
  end: number;
  active: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

const LONG_PRESS_MS = 350;

export function TimeGrid({
  columns,
  appointments,
  columnOf,
  patients,
  types,
  range,
  hourPx,
  timeZone,
  availability,
  now,
  canEdit,
  minColWidth,
  onSlot,
  onOpen,
  onDrop,
}: {
  columns: GridColumn[];
  appointments: Appointment[];
  columnOf: (a: Appointment) => string | null;
  patients: Map<string, Row<"patients">>;
  types: Map<string, Row<"appointment_types">>;
  range: [number, number];
  hourPx: number;
  timeZone: string;
  availability: AvailabilityCtx | undefined;
  now: Date;
  canEdit: boolean;
  minColWidth: number;
  onSlot: (col: GridColumn, minutes: number) => void;
  onOpen: (a: Appointment) => void;
  onDrop: (a: Appointment, col: GridColumn, start: number, end: number) => void;
}) {
  const { t } = useI18n();
  const [from, to] = range;
  const height = ((to - from) / 60) * hourPx;
  const colRefs = useRef(new Map<string, HTMLDivElement>());
  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  const update = (d: DragState | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // Pendant un glisser au doigt, on bloque le défilement de la page.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (dragRef.current?.active) e.preventDefault();
    };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  const byColumn = useMemo(() => {
    const map = new Map<string, { a: Appointment; start: number; end: number }[]>();
    const colDates = new Map(columns.map((c) => [c.key, c.date]));
    for (const a of appointments) {
      const key = columnOf(a);
      if (!key || !colDates.has(key)) continue;
      const date = colDates.get(key)!;
      const start = Math.max(0, isoToMinutes(a.starts_at, date, timeZone));
      const end = Math.min(24 * 60, isoToMinutes(a.ends_at, date, timeZone));
      if (end <= 0 || start >= 24 * 60) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ a, start, end });
    }
    return map;
  }, [appointments, columns, columnOf, timeZone]);

  const colAt = (clientX: number) => {
    for (const c of columns) {
      const el = colRefs.current.get(c.key);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) return c.key;
    }
    return null;
  };

  function onPointerDown(e: ReactPointerEvent, a: Appointment, start: number, end: number, mode: DragMode, colKey: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const d: DragState = {
      id: a.id,
      mode,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      x0: e.clientX,
      y0: e.clientY,
      col0: colKey,
      start0: start,
      end0: end,
      col: colKey,
      start,
      end,
      active: false,
    };
    if (canEdit && e.pointerType === "touch") {
      d.timer = setTimeout(() => {
        if (dragRef.current?.id === a.id) {
          update({ ...dragRef.current, active: true });
          navigator.vibrate?.(15);
        }
      }, LONG_PRESS_MS);
    }
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    update(d);
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.active) {
      if (Math.hypot(dx, dy) < (d.pointerType === "touch" ? 10 : 4)) return;
      if (d.pointerType === "touch" || !canEdit) {
        // Le doigt bouge avant l'appui long : c'est un défilement.
        clearTimeout(d.timer);
        update(null);
        return;
      }
      d.active = true;
    }
    const next = applyDrag({ start: d.start0, end: d.end0 }, pxToMinutes(dy, hourPx), d.mode, [from, to]);
    const col = d.mode === "move" ? (colAt(e.clientX) ?? d.col) : d.col0;
    if (next.start !== d.start || next.end !== d.end || col !== d.col || !dragRef.current?.active) {
      update({ ...d, ...next, col, active: true });
    }
  }

  function onPointerUp(e: ReactPointerEvent, a: Appointment) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    clearTimeout(d.timer);
    update(null);
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    if (!d.active) {
      onOpen(a);
      return;
    }
    if (d.col === d.col0 && d.start === d.start0 && d.end === d.end0) return;
    const col = columns.find((c) => c.key === d.col);
    if (col) onDrop(a, col, d.start, d.end);
  }

  function onPointerCancel() {
    const d = dragRef.current;
    if (d) clearTimeout(d.timer);
    update(null);
  }

  function slotClick(e: ReactMouseEvent<HTMLDivElement>, col: GridColumn) {
    if (suppressClick.current || !canEdit) return;
    const r = e.currentTarget.getBoundingClientRect();
    const minutes = from + Math.floor(pxToMinutes(e.clientY - r.top, hourPx) / 15) * 15;
    onSlot(col, snap(minutes));
  }

  const hours: number[] = [];
  for (let m = Math.ceil(from / 60) * 60; m < to; m += 60) hours.push(m);
  const top = (min: number) => ((min - from) / 60) * hourPx;

  function block(a: Appointment, start: number, end: number, style: CSSProperties, colKey: string, ghost = false) {
    const type = a.type_id ? types.get(a.type_id) : undefined;
    const color = type?.color ?? "var(--text-muted)";
    const inactive = !isActiveStatus(a.status);
    const compact = end - start <= 20;
    const dragging = drag?.id === a.id && drag.active;
    return (
      <div
        key={ghost ? `ghost-${a.id}` : a.id}
        data-appointment={ghost ? undefined : a.id}
        role={ghost ? undefined : "button"}
        tabIndex={ghost ? undefined : 0}
        aria-label={ghost ? undefined : `${minutesToHHMM(start)} ${appointmentLabel(a, patients)}`}
        onKeyDown={(e) => !ghost && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(a))}
        onPointerDown={ghost ? undefined : (e) => onPointerDown(e, a, start, end, "move", colKey)}
        onPointerMove={ghost ? undefined : onPointerMove}
        onPointerUp={ghost ? undefined : (e) => onPointerUp(e, a)}
        onPointerCancel={ghost ? undefined : onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "absolute overflow-hidden rounded-md border-l-4 px-1.5 text-xs leading-tight shadow-sm select-none [-webkit-touch-callout:none]",
          "text-text focus-visible:outline-2 focus-visible:outline-primary",
          canEdit && !ghost ? "cursor-grab" : "cursor-pointer",
          inactive && "opacity-50 line-through",
          dragging && !ghost && "opacity-30",
          ghost && "pointer-events-none z-20 ring-2 ring-primary",
          a._dirty ? "border-dashed" : "",
        )}
        style={{
          ...style,
          borderLeftColor: color,
          backgroundColor: `color-mix(in srgb, ${color} 16%, var(--surface))`,
        }}
      >
        <div className={cn("truncate font-medium", compact ? "py-0" : "pt-0.5")}>
          {!compact && <span className="mr-1 text-muted">{minutesToHHMM(start)}</span>}
          {appointmentLabel(a, patients)}
        </div>
        {!compact && end - start >= 40 && (
          <div className="truncate text-muted">
            {[type?.name, t(`agenda.status.${a.status}`)].filter(Boolean).join(" · ")}
          </div>
        )}
        {canEdit && !ghost && !inactive && (
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
            onPointerDown={(e) => onPointerDown(e, a, start, end, "resize", colKey)}
          />
        )}
      </div>
    );
  }

  const nowMinutesFor = (date: string) => {
    const m = isoToMinutes(now.toISOString(), date, timeZone);
    return m >= from && m <= to && m >= 0 && m < 24 * 60 ? m : null;
  };

  const dragged = drag?.active ? appointments.find((a) => a.id === drag.id) : undefined;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <div style={{ minWidth: 48 + columns.length * minColWidth }}>
        {/* En-têtes de colonnes */}
        <div className="sticky top-0 z-10 flex border-b border-border bg-surface">
          <div className="w-12 shrink-0" />
          {columns.map((c) => (
            <div
              key={c.key}
              className={cn("min-w-0 flex-1 truncate border-l border-border px-2 py-2 text-center text-sm font-medium", c.highlight && "text-primary")}
            >
              {c.label}
            </div>
          ))}
        </div>
        <div ref={bodyRef} className="relative flex" style={{ height }}>
          {/* Heures */}
          <div className="relative w-12 shrink-0">
            {hours.map((m) => (
              <div key={m} className="absolute right-1 -translate-y-1/2 text-[11px] text-muted" style={{ top: top(m) }}>
                {m > from ? minutesToHHMM(m) : ""}
              </div>
            ))}
          </div>
          {columns.map((c) => {
            const items = byColumn.get(c.key) ?? [];
            const lanes = layoutLanes(items.filter((i) => isActiveStatus(i.a.status)).map((i) => ({ id: i.a.id, start: i.start, end: i.end })));
            const greyed = availability ? unavailableIntervals(c.date, c.availabilityDentist, availability) : [];
            const nowMin = nowMinutesFor(c.date);
            return (
              <div
                key={c.key}
                ref={(el) => {
                  if (el) colRefs.current.set(c.key, el);
                  else colRefs.current.delete(c.key);
                }}
                data-column={c.key}
                className="relative min-w-0 flex-1 border-l border-border"
                onClick={(e) => slotClick(e, c)}
              >
                {greyed.map((g, i) =>
                  g.end > from && g.start < to ? (
                    <div
                      key={i}
                      title={g.kind === "off" ? (g.reason ?? t("agenda.timeOff")) : t("agenda.closed")}
                      className={cn(
                        "pointer-events-none absolute inset-x-0",
                        g.kind === "off"
                          ? "bg-[repeating-linear-gradient(135deg,var(--border)_0,var(--border)_6px,transparent_6px,transparent_12px)]"
                          : "bg-background",
                      )}
                      style={{ top: top(Math.max(g.start, from)), height: top(Math.min(g.end, to)) - top(Math.max(g.start, from)) }}
                    />
                  ) : null,
                )}
                {hours.map((m) => (
                  <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ top: top(m) }} />
                ))}
                {items.map(({ a, start, end }) => {
                  const lane = lanes.get(a.id) ?? { lane: 0, lanes: 1 };
                  const width = 100 / lane.lanes;
                  return block(
                    a,
                    start,
                    end,
                    {
                      top: top(Math.max(start, from)) + 1,
                      height: Math.max(top(Math.min(end, to)) - top(Math.max(start, from)) - 2, 16),
                      left: `calc(${lane.lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                    },
                    c.key,
                  );
                })}
                {dragged && drag && drag.col === c.key &&
                  block(dragged, drag.start, drag.end, { top: top(drag.start) + 1, height: Math.max(top(drag.end) - top(drag.start) - 2, 16), left: 2, right: 2 }, c.key, true)}
                {dragged && drag && drag.col === c.key && (
                  <div className="pointer-events-none absolute left-1 z-30 rounded bg-primary px-1 text-[11px] text-on-primary" style={{ top: top(drag.start) - 16 }}>
                    {minutesToHHMM(drag.start)}–{minutesToHHMM(drag.end)}
                  </div>
                )}
                {nowMin !== null && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: top(nowMin) }} aria-label={t("agenda.now")}>
                    <span className="absolute -left-1 -top-1.5 size-3 rounded-full bg-danger" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
