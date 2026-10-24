"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { localDb } from "@/lib/local/db";
import { mutate, softDelete } from "@/lib/sync/mutate";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { useI18n } from "@/components/i18n-provider";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RequirePermission } from "@/components/app/app-gate";
import { useAppointmentTypes, useChairs, useDentists } from "../lib/data";
import { hhmmToMinutes } from "../lib/grid";
// Conversion heure locale du cabinet -> UTC (logique partagée avec les Edge Functions).
import { zonedTime } from "../../../../supabase/functions/_shared/reminders";

type Tab = "chairs" | "types" | "schedules" | "timeOff";

export function AgendaSettings() {
  const { t } = useI18n();
  const { can, roles } = useCabinet();
  const isStaffScheduler = roles.includes("admin") || roles.includes("assistant");
  const allowed = can.settings || isStaffScheduler || can.isDentist;
  const tabs: { value: Tab; label: string }[] = [
    ...(can.settings
      ? [
          { value: "chairs" as const, label: t("agenda.settings.tabs.chairs") },
          { value: "types" as const, label: t("agenda.settings.tabs.types") },
        ]
      : []),
    { value: "schedules", label: t("agenda.settings.tabs.schedules") },
    { value: "timeOff", label: t("agenda.settings.tabs.timeOff") },
  ];
  const [tab, setTab] = useState<Tab>(tabs[0].value);
  const current = tabs.some((x) => x.value === tab) ? tab : tabs[0].value;

  return (
    <RequirePermission allowed={allowed}>
      <PageHeader title={t("agenda.settings.title")} />
      <Tabs value={current} onChange={setTab} items={tabs} />
      <div className="mt-4">
        {current === "chairs" && <ChairsEditor />}
        {current === "types" && <TypesEditor />}
        {current === "schedules" && <SchedulesEditor />}
        {current === "timeOff" && <TimeOffEditor />}
      </div>
    </RequirePermission>
  );
}

/** Praticiens modifiables par l'utilisateur (miroir de la RLS horaires/absences). */
function useEditableDentists() {
  const { roles, readOnly } = useCabinet();
  const { user } = useAuth();
  const dentists = useDentists();
  const all = roles.includes("admin") || roles.includes("assistant");
  return {
    dentists: (dentists ?? []).filter((d) => all || d.id === user?.id),
    canCabinetWide: all && !readOnly,
    writable: !readOnly,
    onlyOwn: !all,
  };
}

// ---------------------------------------------------------------------------
// Fauteuils
// ---------------------------------------------------------------------------

function ChairsEditor() {
  const { t } = useI18n();
  const cabinetId = useCabinetId();
  const { can } = useCabinet();
  const chairs = useChairs();
  const [name, setName] = useState("");
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);
  const write = can.settingsWrite;

  async function add() {
    if (!name.trim()) return;
    await mutate("chairs", { cabinet_id: cabinetId, name: name.trim(), sort_order: (chairs?.length ?? 0) + 1 });
    setName("");
  }

  async function move(i: number, dir: -1 | 1) {
    if (!chairs) return;
    const j = i + dir;
    if (j < 0 || j >= chairs.length) return;
    const list = [...chairs];
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((c, k) => (c.sort_order !== k + 1 ? mutate("chairs", { id: c.id, sort_order: k + 1 }) : null)));
  }

  return (
    <Card>
      <ul className="divide-y divide-border">
        {chairs?.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2 px-4 py-2">
            <Input
              aria-label={t("agenda.settings.chairName")}
              defaultValue={c.name}
              disabled={!write}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.name && mutate("chairs", { id: c.id, name: e.target.value.trim() })}
            />
            {write && (
              <>
                <Button variant="ghost" size="sm" aria-label={t("agenda.settings.moveUp")} onClick={() => move(i, -1)} disabled={i === 0}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button variant="ghost" size="sm" aria-label={t("agenda.settings.moveDown")} onClick={() => move(i, 1)} disabled={i === chairs.length - 1}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button variant="ghost" size="sm" aria-label={t("common.delete")} onClick={() => setToDelete(c)}>
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </>
            )}
          </li>
        ))}
        {chairs?.length === 0 && <li className="px-4 py-3 text-sm text-muted">{t("agenda.settings.noChairs")}</li>}
      </ul>
      {write && (
        <form
          className="flex gap-2 border-t border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input aria-label={t("agenda.settings.chairName")} placeholder={t("agenda.settings.chairName")} value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={!name.trim()}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("agenda.settings.addChair")}</span>
          </Button>
        </form>
      )}
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && void softDelete("chairs", toDelete.id)}
        title={t("common.delete")}
        message={t("agenda.settings.confirmDelete", { name: toDelete?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        danger
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Types de rendez-vous
// ---------------------------------------------------------------------------

function TypesEditor() {
  const { t } = useI18n();
  const cabinetId = useCabinetId();
  const { can } = useCabinet();
  const types = useAppointmentTypes();
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);
  const write = can.settingsWrite;

  async function add() {
    await mutate("appointment_types", {
      cabinet_id: cabinetId,
      name: t("agenda.settings.typeName"),
      duration_minutes: 30,
      color: "#0F766E",
      bookable_online: false,
      sort_order: (types?.length ?? 0) + 1,
    });
  }

  async function move(i: number, dir: -1 | 1) {
    if (!types) return;
    const j = i + dir;
    if (j < 0 || j >= types.length) return;
    const list = [...types];
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((c, k) => (c.sort_order !== k + 1 ? mutate("appointment_types", { id: c.id, sort_order: k + 1 }) : null)));
  }

  return (
    <Card>
      <ul className="divide-y divide-border">
        {types?.map((ty, i) => (
          <li key={ty.id} className="grid grid-cols-[auto_1fr] items-end gap-2 px-4 py-3 sm:grid-cols-[auto_1fr_7rem_auto_auto]">
            <input
              type="color"
              aria-label={t("agenda.settings.color")}
              defaultValue={ty.color}
              disabled={!write}
              onChange={(e) => mutate("appointment_types", { id: ty.id, color: e.target.value.toUpperCase() })}
              className="size-10 cursor-pointer rounded-lg border border-border bg-surface p-1"
            />
            <Input
              aria-label={t("agenda.settings.typeName")}
              defaultValue={ty.name}
              disabled={!write}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== ty.name && mutate("appointment_types", { id: ty.id, name: e.target.value.trim() })}
            />
            <Field label={t("agenda.settings.duration")} className="col-span-2 sm:col-span-1">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={5}
                  max={480}
                  step={5}
                  defaultValue={ty.duration_minutes}
                  disabled={!write}
                  onBlur={(e) => {
                    const v = Math.round(Number(e.target.value));
                    if (v >= 5 && v <= 480 && v !== ty.duration_minutes) void mutate("appointment_types", { id: ty.id, duration_minutes: v });
                    else e.target.value = String(ty.duration_minutes);
                  }}
                />
              )}
            </Field>
            <Checkbox
              className="h-10"
              label={t("agenda.settings.bookableOnline")}
              checked={ty.bookable_online}
              disabled={!write}
              onChange={(e) => mutate("appointment_types", { id: ty.id, bookable_online: e.target.checked })}
            />
            {write && (
              <div className="flex">
                <Button variant="ghost" size="sm" aria-label={t("agenda.settings.moveUp")} onClick={() => move(i, -1)} disabled={i === 0}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button variant="ghost" size="sm" aria-label={t("agenda.settings.moveDown")} onClick={() => move(i, 1)} disabled={i === types.length - 1}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button variant="ghost" size="sm" aria-label={t("common.delete")} onClick={() => setToDelete(ty)}>
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </div>
            )}
          </li>
        ))}
        {types?.length === 0 && <li className="px-4 py-3 text-sm text-muted">{t("agenda.settings.noTypes")}</li>}
      </ul>
      {write && (
        <div className="border-t border-border p-4">
          <Button onClick={add}>
            <Plus className="size-4" />
            {t("agenda.settings.addType")}
          </Button>
        </div>
      )}
      {!write && <p className="border-t border-border p-4 text-sm text-muted">{t("agenda.settings.settingsOnlyAdmin")}</p>}
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && void softDelete("appointment_types", toDelete.id)}
        title={t("common.delete")}
        message={t("agenda.settings.confirmDelete", { name: toDelete?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        danger
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Horaires hebdomadaires
// ---------------------------------------------------------------------------

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const hm = (time: string) => time.slice(0, 5);

function SchedulesEditor() {
  const { t } = useI18n();
  const cabinetId = useCabinetId();
  const toast = useToast();
  const { dentists, writable, onlyOwn } = useEditableDentists();
  const [selected, setSelected] = useState("");
  const dentistId = dentists.some((d) => d.id === selected) ? selected : (dentists[0]?.id ?? "");

  const rows = useLiveQuery(
    async () =>
      dentistId
        ? (await localDb().practitioner_schedules.where("dentist_id").equals(dentistId).toArray()).filter(
            (s) => s.cabinet_id === cabinetId && !s.deleted_at,
          )
        : [],
    [dentistId, cabinetId],
  );
  const byDay = useMemo(() => {
    const m = new Map<number, NonNullable<typeof rows>>();
    for (const r of rows ?? []) m.set(r.weekday, [...(m.get(r.weekday) ?? []), r].sort((a, b) => a.start_time.localeCompare(b.start_time)));
    return m;
  }, [rows]);

  async function addInterval(weekday: number) {
    const last = byDay.get(weekday)?.at(-1);
    const start = last ? hm(last.end_time) : "08:00";
    const startMin = hhmmToMinutes(start);
    if (startMin >= 23 * 60) return;
    const end = `${String(Math.min(Math.floor(startMin / 60) + 4, 23)).padStart(2, "0")}:${start.slice(3)}`;
    await mutate("practitioner_schedules", { cabinet_id: cabinetId, dentist_id: dentistId, weekday, start_time: start, end_time: end });
  }

  async function update(id: string, field: "start_time" | "end_time", value: string, other: string) {
    const start = field === "start_time" ? value : other;
    const end = field === "end_time" ? value : other;
    if (!value || hhmmToMinutes(end) <= hhmmToMinutes(start)) {
      toast(t("agenda.settings.invalidInterval"), "error");
      return false;
    }
    await mutate("practitioner_schedules", { id, [field]: value });
    return true;
  }

  async function copyMonday() {
    const monday = byDay.get(1) ?? [];
    for (const wd of [2, 3, 4, 5]) {
      for (const r of byDay.get(wd) ?? []) await softDelete("practitioner_schedules", r.id);
      for (const r of monday) {
        await mutate("practitioner_schedules", { cabinet_id: cabinetId, dentist_id: dentistId, weekday: wd, start_time: r.start_time, end_time: r.end_time });
      }
    }
    toast(t("common.saved"));
  }

  if (!dentists.length) return <p className="text-sm text-muted">{t("agenda.noDentist")}</p>;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t("agenda.settings.schedulesFor")}
            <Select aria-label={t("agenda.dentist")} value={dentistId} onChange={(e) => setSelected(e.target.value)} className="h-9 max-w-48" disabled={dentists.length < 2}>
              {dentists.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </span>
        }
        actions={
          writable && (
            <Button size="sm" variant="secondary" onClick={copyMonday} disabled={!byDay.get(1)?.length}>
              <Copy className="size-4" />
              <span className="hidden sm:inline">{t("agenda.settings.copyMonday")}</span>
            </Button>
          )
        }
      />
      <CardBody className="flex flex-col gap-1 p-0">
        <p className="px-4 pt-3 text-xs text-muted">
          {t("agenda.settings.schedulesHint")} {onlyOwn && t("agenda.settings.onlyOwn")}
        </p>
        <ul className="divide-y divide-border">
          {WEEKDAYS.map((wd) => {
            const list = byDay.get(wd) ?? [];
            return (
              <li key={wd} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                <span className="w-28 shrink-0 pt-2 text-sm font-medium">{t(`agenda.settings.weekday.${wd}`)}</span>
                <div className="flex flex-1 flex-col gap-2">
                  {list.length === 0 && <span className="pt-2 text-sm text-muted">{t("agenda.settings.dayOff")}</span>}
                  {list.map((r) => (
                    <div key={r.id} className="flex items-center gap-2">
                      <Input
                        type="time"
                        step={900}
                        aria-label={t("agenda.form.start")}
                        defaultValue={hm(r.start_time)}
                        disabled={!writable}
                        className="max-w-36"
                        onBlur={async (e) => {
                          if (e.target.value === hm(r.start_time)) return;
                          if (!(await update(r.id, "start_time", e.target.value, hm(r.end_time)))) e.target.value = hm(r.start_time);
                        }}
                      />
                      <span className="text-muted">–</span>
                      <Input
                        type="time"
                        step={900}
                        aria-label={t("agenda.form.end")}
                        defaultValue={hm(r.end_time)}
                        disabled={!writable}
                        className="max-w-36"
                        onBlur={async (e) => {
                          if (e.target.value === hm(r.end_time)) return;
                          if (!(await update(r.id, "end_time", e.target.value, hm(r.start_time)))) e.target.value = hm(r.end_time);
                        }}
                      />
                      {writable && (
                        <Button variant="ghost" size="sm" aria-label={t("common.delete")} onClick={() => softDelete("practitioner_schedules", r.id)}>
                          <Trash2 className="size-4 text-danger" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {writable && (
                    <div>
                      <Button variant="ghost" size="sm" onClick={() => addInterval(wd)}>
                        <Plus className="size-4" />
                        {t("agenda.settings.addInterval")}
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Absences et congés
// ---------------------------------------------------------------------------

function toLocalInput(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

function fromLocalInput(value: string, timeZone: string) {
  const [d, time] = value.split("T");
  return zonedTime(d, time, timeZone).toISOString();
}

function TimeOffEditor() {
  const { t, locale } = useI18n();
  const cabinetId = useCabinetId();
  const { cabinet } = useCabinet();
  const toast = useToast();
  const tz = cabinet?.timezone ?? "Africa/Conakry";
  const { dentists, canCabinetWide, writable, onlyOwn } = useEditableDentists();
  const allDentists = useDentists();
  const nowIso = new Date().toISOString();
  const [who, setWho] = useState<string>("");
  const [from, setFrom] = useState(() => toLocalInput(new Date().toISOString(), tz).slice(0, 10) + "T08:00");
  const [to, setTo] = useState(() => toLocalInput(new Date().toISOString(), tz).slice(0, 10) + "T18:00");
  const [reason, setReason] = useState("");
  const target = who || (canCabinetWide ? "" : (dentists[0]?.id ?? ""));

  const list = useLiveQuery(
    async () => (await localDb().time_off.where("cabinet_id").equals(cabinetId).toArray()).filter((x) => !x.deleted_at),
    [cabinetId],
  );
  const names = new Map((allDentists ?? []).map((d) => [d.id, d.name]));
  const editable = new Set(dentists.map((d) => d.id));
  const upcoming = (list ?? []).filter((x) => x.ends_at >= nowIso).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = (list ?? []).filter((x) => x.ends_at < nowIso).sort((a, b) => b.starts_at.localeCompare(a.starts_at)).slice(0, 20);

  async function add() {
    if (!from || !to) return;
    const s = fromLocalInput(from, tz);
    const e = fromLocalInput(to, tz);
    if (e <= s) return toast(t("agenda.settings.invalidInterval"), "error");
    await mutate("time_off", { cabinet_id: cabinetId, dentist_id: target || null, starts_at: s, ends_at: e, reason: reason.trim() || null });
    setReason("");
    toast(t("common.saved"));
  }

  const item = (x: NonNullable<typeof list>[number]) => {
    const canEdit = writable && (x.dentist_id ? editable.has(x.dentist_id) : canCabinetWide);
    return (
      <li key={x.id} className="flex items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{x.dentist_id ? (names.get(x.dentist_id) ?? "—") : t("agenda.settings.wholeCabinet")}</div>
          <div className="text-xs text-muted">
            {formatDateTime(x.starts_at, locale, tz)} → {formatDateTime(x.ends_at, locale, tz)}
            {x.reason ? ` · ${x.reason}` : ""}
          </div>
        </div>
        {canEdit && (
          <Button variant="ghost" size="sm" aria-label={t("common.delete")} onClick={() => softDelete("time_off", x.id)}>
            <Trash2 className="size-4 text-danger" />
          </Button>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {writable && (
        <Card>
          <CardHeader title={t("agenda.settings.addTimeOff")} />
          <CardBody>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <Field label={t("agenda.settings.timeOffFor")}>
                {(p) => (
                  <Select {...p} value={target} onChange={(e) => setWho(e.target.value)}>
                    {canCabinetWide && <option value="">{t("agenda.settings.wholeCabinet")}</option>}
                    {dentists.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t("agenda.settings.reason")}>
                {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
              </Field>
              <Field label={t("agenda.settings.from")} required>
                {(p) => <Input {...p} type="datetime-local" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />}
              </Field>
              <Field label={t("agenda.settings.to")} required>
                {(p) => <Input {...p} type="datetime-local" step={900} value={to} onChange={(e) => setTo(e.target.value)} />}
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={!canCabinetWide && !target}>
                  <Plus className="size-4" />
                  {t("agenda.settings.addTimeOff")}
                </Button>
                {onlyOwn && <span className="ml-3 text-xs text-muted">{t("agenda.settings.onlyOwn")}</span>}
              </div>
            </form>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title={t("agenda.settings.upcomingTimeOff")} />
        {upcoming.length ? <ul className="divide-y divide-border">{upcoming.map(item)}</ul> : <p className="px-4 py-3 text-sm text-muted">{t("agenda.settings.noTimeOff")}</p>}
      </Card>
      {past.length > 0 && (
        <Card>
          <CardHeader title={t("agenda.settings.pastTimeOff")} />
          <ul className="divide-y divide-border">{past.map(item)}</ul>
        </Card>
      )}
    </div>
  );
}
