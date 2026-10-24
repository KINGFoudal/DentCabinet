"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { localDb } from "@/lib/local/db";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { todayISO } from "@/lib/dates";
import { formatTime, fullName } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/input";
import { PageHeader, PageSpinner } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/toast";
import {
  availabilityWarnings,
  displayHours,
  hhmmToMinutes,
  isActiveStatus,
  isoToMinutes,
  localDay,
  minutesToISO,
  shiftDate,
  viewDays,
  viewRange,
  type View,
} from "../lib/grid";
import { useAppointmentTypes, useAppointmentsInRange, useAvailability, useChairs, useDentists, type Appointment } from "../lib/data";
import { saveAppointment } from "../lib/actions";
import { useIsMobile, useNow, usePersistentState } from "../lib/hooks";
import { TimeGrid, type GridColumn } from "./time-grid";
import { MonthView } from "./month-view";
import { AppointmentDialog, type AppointmentDefaults } from "./appointment-dialog";

const VIEWS = ["day", "week", "month"] as const;
const MODES = ["dentist", "chair"] as const;

export function AgendaView() {
  const { t, locale } = useI18n();
  const cabinetId = useCabinetId();
  const { cabinet, can } = useCabinet();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const tz = cabinet?.timezone ?? "Africa/Conakry";
  const isMobile = useIsMobile();
  const now = useNow();
  const today = todayISO(tz, now);

  const [view, setView] = usePersistentState<View>("nimba-agenda-view", "day", VIEWS);
  const [mode, setMode] = usePersistentState<(typeof MODES)[number]>("nimba-agenda-mode", "dentist", MODES);
  const [dentistFilter, setDentistFilter] = usePersistentState<string>("nimba-agenda-dentist", "");
  const [showCancelled, setShowCancelled] = useState(false);
  const [date, setDate] = useState(() => params.get("date") ?? today);
  const [dialog, setDialog] = useState<{ appointment?: Appointment | null; defaults?: AppointmentDefaults } | null>(null);

  const dentists = useDentists();
  const chairs = useChairs();
  const types = useAppointmentTypes();
  const availability = useAvailability();
  const [rangeStart, rangeEnd] = viewRange(view, date, tz);
  const data = useAppointmentsInRange(rangeStart, rangeEnd);

  // Liens profonds : ?rdv=<id> ouvre un RDV, ?nouveau=1&patient=<id> crée un RDV.
  useEffect(() => {
    const rdv = params.get("rdv");
    const patient = params.get("patient");
    if (!rdv && !params.get("nouveau")) return;
    let cancelled = false;
    void (async () => {
      const appt = rdv ? await localDb().appointments.get(rdv) : undefined;
      if (cancelled) return;
      if (appt) {
        setDate(localDay(appt.starts_at, tz));
        setDialog({ appointment: appt });
      } else if (params.get("nouveau")) setDialog({ defaults: { patient_id: patient } });
      router.replace("/app/agenda");
    })();
    return () => {
      cancelled = true;
    };
  }, [params, router, tz]);

  const typeMap = useMemo(() => new Map((types ?? []).map((x) => [x.id, x])), [types]);
  const visibleDentists = useMemo(
    () => (dentists ?? []).filter((d) => !dentistFilter || d.id === dentistFilter),
    [dentists, dentistFilter],
  );
  const filterId = dentistFilter && dentists?.some((d) => d.id === dentistFilter) ? dentistFilter : "";

  const appointments = useMemo(
    () =>
      (data?.appts ?? []).filter(
        (a) => (showCancelled || isActiveStatus(a.status)) && (!filterId || a.dentist_id === filterId),
      ),
    [data, showCancelled, filterId],
  );

  const effectiveView: View = view;
  const days = viewDays(effectiveView, date);
  const dayFmt = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });

  // Colonnes de la grille.
  const hasNoChair = appointments.some((a) => !a.chair_id);
  const columns: GridColumn[] = useMemo(() => {
    if (effectiveView === "week") {
      return days.map((d) => ({
        key: d,
        date: d,
        label: dayFmt.format(new Date(`${d}T00:00:00Z`)),
        availabilityDentist: filterId || null,
        highlight: d === today,
      }));
    }
    if (isMobile) {
      const dentist = filterId || (visibleDentists.length === 1 ? visibleDentists[0].id : null);
      return [{ key: "all", date, label: dayFmt.format(new Date(`${date}T00:00:00Z`)), availabilityDentist: dentist, highlight: date === today }];
    }
    if (mode === "chair") {
      const cols: GridColumn[] = (chairs ?? []).map((c) => ({ key: `chair:${c.id}`, date, label: c.name, availabilityDentist: filterId || null }));
      if (hasNoChair || !cols.length) cols.push({ key: "chair:none", date, label: t("agenda.noChair"), availabilityDentist: filterId || null });
      return cols;
    }
    return visibleDentists.map((d) => ({
      key: `dentist:${d.id}`,
      date,
      label: (
        <span className="inline-flex items-center gap-1.5">
          {d.color && <span className="size-2.5 rounded-full" style={{ backgroundColor: d.color }} />}
          {d.name}
        </span>
      ),
      availabilityDentist: d.id,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- days/dayFmt dérivent de date/view/locale
  }, [effectiveView, date, today, isMobile, mode, chairs, visibleDentists, filterId, hasNoChair, locale, t]);

  const columnOf = useCallback(
    (a: Appointment) => {
      if (effectiveView === "week") {
        return localDay(a.starts_at, tz);
      }
      if (isMobile) return "all";
      if (mode === "chair") return a.chair_id && chairs?.some((c) => c.id === a.chair_id) ? `chair:${a.chair_id}` : "chair:none";
      return `dentist:${a.dentist_id}`;
    },
    [effectiveView, isMobile, mode, chairs, tz],
  );

  // Plage horaire : 7 h - 20 h, élargie aux horaires d'ouverture et aux RDV.
  const range = useMemo(() => {
    const intervals: [number, number][] = [];
    const oh = availability?.openingHours ?? {};
    for (const list of Object.values(oh ?? {})) for (const [s, e] of list ?? []) intervals.push([hhmmToMinutes(s), hhmmToMinutes(e)]);
    for (const s of availability?.schedules ?? []) intervals.push([hhmmToMinutes(s.start_time), hhmmToMinutes(s.end_time)]);
    for (const a of appointments) {
      const d = localDay(a.starts_at, tz);
      intervals.push([isoToMinutes(a.starts_at, d, tz), Math.min(isoToMinutes(a.ends_at, d, tz), 24 * 60)]);
    }
    return displayHours(intervals.filter(([s, e]) => s >= 0 && e <= 24 * 60 && e > s));
  }, [availability, appointments, tz]);

  function columnTarget(col: GridColumn) {
    const target: { dentist_id?: string; chair_id?: string | null } = {};
    if (col.key.startsWith("dentist:")) target.dentist_id = col.key.slice(8);
    if (col.key.startsWith("chair:")) target.chair_id = col.key === "chair:none" ? null : col.key.slice(6);
    return target;
  }

  function openNew(col: GridColumn | null, minutes?: number) {
    if (!can.agendaWrite) return;
    const d = col?.date ?? date;
    const startMin = minutes ?? Math.max(range[0], 9 * 60);
    const target = col ? columnTarget(col) : {};
    setDialog({
      defaults: {
        starts_at: minutesToISO(d, startMin, tz),
        ends_at: minutesToISO(d, startMin + 30, tz),
        dentist_id: target.dentist_id ?? (filterId || undefined),
        chair_id: target.chair_id,
      },
    });
  }

  async function onDrop(a: Appointment, col: GridColumn, start: number, end: number) {
    const target = columnTarget(col);
    const patch = {
      starts_at: minutesToISO(col.date, start, tz),
      ends_at: minutesToISO(col.date, end, tz),
      dentist_id: target.dentist_id ?? a.dentist_id,
      ...(target.chair_id !== undefined ? { chair_id: target.chair_id } : {}),
    };
    const res = await saveAppointment(cabinetId, patch, a);
    if (!res.ok) {
      const c = res.conflicts[0];
      const who = (c.appointment.patient_id && data?.patients.get(c.appointment.patient_id)) ? fullName(data.patients.get(c.appointment.patient_id)) : (c.appointment.title ?? "—");
      toast(
        t(c.reason === "dentist" ? "agenda.form.conflictDentist" : "agenda.form.conflictChair", {
          from: formatTime(c.appointment.starts_at, locale, tz),
          to: formatTime(c.appointment.ends_at, locale, tz),
          who,
        }),
        "error",
      );
      return;
    }
    const warnings = availability ? availabilityWarnings({ dentist_id: patch.dentist_id, starts_at: patch.starts_at, ends_at: patch.ends_at }, availability) : [];
    if (warnings.length) toast(t(warnings[0] === "outside_hours" ? "agenda.form.outsideHours" : "agenda.form.timeOff"), "info");
    else toast(t("agenda.moved"));
  }

  const title = (() => {
    const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { ...opts, timeZone: "UTC" });
    const d = new Date(`${date}T00:00:00Z`);
    if (effectiveView === "day")
      return fmt(isMobile ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
    if (effectiveView === "month") return fmt({ month: "long", year: "numeric" }).format(d);
    const first = new Date(`${days[0]}T00:00:00Z`);
    const last = new Date(`${days[6]}T00:00:00Z`);
    return `${fmt({ day: "numeric", month: "short" }).format(first)} – ${fmt({ day: "numeric", month: "short", year: "numeric" }).format(last)}`;
  })();

  if (!dentists || !data) return <PageSpinner />;

  const hourPx = isMobile ? 64 : 52;

  return (
    <>
      <PageHeader
        title={t("agenda.title")}
        actions={
          can.agendaWrite && (
            <Button onClick={() => openNew(null)}>
              <Plus className="size-4" />
              {t("agenda.newAppointment")}
            </Button>
          )
        }
      />

      <div className="mb-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => setDate(today)}>
              {t("agenda.today")}
            </Button>
            <Button variant="ghost" size="sm" aria-label={t("agenda.previous")} onClick={() => setDate(shiftDate(effectiveView, date, -1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" aria-label={t("agenda.next")} onClick={() => setDate(shiftDate(effectiveView, date, 1))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <label className="relative min-w-0 flex-1 truncate font-medium first-letter:uppercase">
            {title}
            <input
              type="date"
              aria-label={t("agenda.form.date")}
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <div role="tablist" className="flex rounded-lg border border-border bg-surface p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v}
                role="tab"
                type="button"
                aria-selected={effectiveView === v}
                onClick={() => setView(v)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm",
                  effectiveView === v ? "bg-primary text-on-primary" : "text-muted hover:text-text",
                )}
              >
                {t(`agenda.views.${v}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label={t("agenda.dentist")} value={filterId} onChange={(e) => setDentistFilter(e.target.value)} className="h-9 max-w-56">
            <option value="">{t("agenda.allDentists")}</option>
            {dentists.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          {effectiveView === "day" && !isMobile && (
            <Select aria-label={t("agenda.columns.label")} value={mode} onChange={(e) => setMode(e.target.value as (typeof MODES)[number])} className="h-9 max-w-44">
              <option value="dentist">{t("agenda.columns.dentist")}</option>
              <option value="chair">{t("agenda.columns.chair")}</option>
            </Select>
          )}
          <Checkbox label={t("agenda.showCancelled")} checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
        </div>
      </div>

      {dentists.length === 0 && <p className="mb-3 rounded-lg bg-warning-soft p-3 text-sm text-warning">{t("agenda.noDentist")}</p>}

      {effectiveView === "month" ? (
        <MonthView
          date={date}
          today={today}
          appointments={appointments}
          patients={data.patients}
          types={typeMap}
          timeZone={tz}
          onDay={(d) => {
            setDate(d);
            setView("day");
          }}
          onOpen={(a) => setDialog({ appointment: a })}
        />
      ) : (
        <>
          <TimeGrid
            columns={columns}
            appointments={appointments}
            columnOf={columnOf}
            patients={data.patients}
            types={typeMap}
            range={range}
            hourPx={hourPx}
            timeZone={tz}
            availability={availability}
            now={now}
            canEdit={can.agendaWrite}
            minColWidth={effectiveView === "week" ? (isMobile ? 84 : 110) : 150}
            onSlot={(col, m) => openNew(col, m)}
            onOpen={(a) => setDialog({ appointment: a })}
            onDrop={onDrop}
          />
          {can.agendaWrite && <p className="mt-2 text-xs text-muted">{t("agenda.dragHint")}</p>}
        </>
      )}

      <AppointmentDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        appointment={dialog?.appointment}
        defaults={dialog?.defaults}
      />
    </>
  );
}
