"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { localDb } from "@/lib/local/db";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { useI18n } from "@/components/i18n-provider";
import { formatTime } from "@/lib/format";
import { todayISO } from "@/lib/dates";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TimeSelect } from "@/components/ui/time-select";
import { useToast } from "@/components/ui/toast";
import { PatientPicker } from "@/features/patients/components/patient-picker";
import { FinishConsultationButton } from "@/features/patients/components/consultation";
import {
  availabilityWarnings,
  durationOptions,
  findConflicts,
  formatDuration,
  hhmmToMinutes,
  isoToMinutes,
  localDay,
  minutesToHHMM,
  minutesToISO,
  nextStatuses,
  primaryNextStatus,
  statusTone,
  type Conflict,
  type Status,
} from "../lib/grid";
import { appointmentLabel, appointmentLabelLocal, useAppointmentTypes, useAvailability, useChairs, useDentists, type Appointment } from "../lib/data";
import { changeStatus, saveAppointment } from "../lib/actions";
import { ReminderStatus } from "./reminder-status";
import { AppointmentWhatsApp } from "@/features/whatsapp/components/context-buttons";
import { AppointmentCreated, appointmentHasWhatsApp } from "@/features/whatsapp/components/appointment-created";

export type AppointmentDefaults = {
  starts_at?: string;
  ends_at?: string;
  dentist_id?: string | null;
  chair_id?: string | null;
  patient_id?: string | null;
  /** Absent : type par défaut du cabinet ; null : sans type. */
  type_id?: string | null;
};

export function AppointmentDialog({
  open,
  onClose,
  appointment,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  appointment?: Appointment | null;
  defaults?: AppointmentDefaults;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} size="lg" title={appointment ? t("agenda.form.editTitle") : t("agenda.form.createTitle")}>
      <AppointmentForm key={appointment?.id ?? "new"} appointment={appointment ?? null} defaults={defaults ?? {}} onDone={onClose} />
    </Dialog>
  );
}

function AppointmentForm({
  appointment,
  defaults,
  onDone,
}: {
  appointment: Appointment | null;
  defaults: AppointmentDefaults;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const cabinetId = useCabinetId();
  const { cabinet, can } = useCabinet();
  const { user } = useAuth();
  const toast = useToast();
  const tz = cabinet?.timezone ?? "Africa/Conakry";
  const dentists = useDentists();
  const chairs = useChairs();
  const types = useAppointmentTypes();
  const availability = useAvailability();

  // Version à jour du RDV (statut modifié par une action rapide, synchronisation...).
  const live = useLiveQuery(async () => (appointment ? ((await localDb().appointments.get(appointment.id)) ?? null) : null), [appointment?.id]);
  const current = live ?? appointment;

  const initStart = appointment?.starts_at ?? defaults.starts_at ?? null;
  const initDate = initStart ? localDay(initStart, tz) : todayISO(tz);
  const initEnd = appointment?.ends_at ?? defaults.ends_at ?? null;
  const [patientId, setPatientId] = useState<string | null>(appointment?.patient_id ?? defaults.patient_id ?? null);
  const [freeLabel, setFreeLabel] = useState(!!appointment && !appointment.patient_id && !!appointment.title);
  const [title, setTitle] = useState(appointment?.title ?? "");
  // undefined = type par défaut du cabinet (le premier), "" = sans type.
  const [typeId, setTypeId] = useState<string | undefined>(appointment ? (appointment.type_id ?? "") : defaults.type_id === undefined ? undefined : (defaults.type_id ?? ""));
  const [dentistId, setDentistId] = useState<string>(appointment?.dentist_id ?? defaults.dentist_id ?? "");
  const [chairId, setChairId] = useState<string>(appointment?.chair_id ?? defaults.chair_id ?? "");
  const [date, setDate] = useState(initDate);
  // Sans heure fournie : prochain quart d'heure (aujourd'hui).
  const [start, setStart] = useState(() =>
    initStart
      ? minutesToHHMM(isoToMinutes(initStart, initDate, tz))
      : minutesToHHMM(Math.min(Math.ceil(isoToMinutes(new Date().toISOString(), initDate, tz) / 15) * 15, 23 * 60 + 45)),
  );
  // undefined = durée du type choisi.
  const [duration, setDuration] = useState<number | undefined>(() =>
    initStart && initEnd ? Math.round((new Date(initEnd).getTime() - new Date(initStart).getTime()) / 60000) : undefined,
  );
  const [notes, setNotes] = useState(appointment?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // RDV tout juste créé : proposer la confirmation WhatsApp au patient.
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Praticien par défaut : soi-même si dentiste, sinon le premier.
  const effectiveDentist = dentistId || (dentists?.find((d) => d.id === user?.id)?.id ?? dentists?.[0]?.id ?? "");
  const effectiveChair = chairId || (!appointment && defaults.chair_id === undefined && chairs?.length === 1 ? chairs[0].id : chairId);
  const effectiveType = typeId ?? types?.[0]?.id ?? "";
  const typeDuration = types?.find((x) => x.id === effectiveType)?.duration_minutes;
  const effectiveDuration = duration ?? typeDuration ?? 30;

  const startMin = hhmmToMinutes(start);
  const endMin = startMin + effectiveDuration;
  const validTimes = !!date && !!start && effectiveDuration > 0 && endMin <= 24 * 60;
  const startsAt = validTimes ? minutesToISO(date, startMin, tz) : null;
  const endsAt = validTimes ? minutesToISO(date, endMin, tz) : null;
  const status = current?.status ?? "scheduled";

  const conflicts = useLiveQuery(async () => {
    if (!startsAt || !endsAt || !effectiveDentist) return [];
    const db = localDb();
    const from = new Date(new Date(startsAt).getTime() - 24 * 3600 * 1000).toISOString();
    const others = await db.appointments.where("[cabinet_id+starts_at]").between([cabinetId, from], [cabinetId, endsAt], true, false).toArray();
    const found = findConflicts(
      { id: appointment?.id, dentist_id: effectiveDentist, chair_id: effectiveChair || null, starts_at: startsAt, ends_at: endsAt, status },
      others,
    );
    const ids = found.map((c) => c.appointment.patient_id).filter(Boolean) as string[];
    const patients = new Map((await db.patients.bulkGet(ids)).filter((p) => !!p).map((p) => [p!.id, p!]));
    return found.map((c) => ({ ...c, who: appointmentLabel(c.appointment, patients) }));
  }, [cabinetId, startsAt, endsAt, effectiveDentist, effectiveChair, appointment?.id, status]);

  const warnings = useMemo(
    () => (startsAt && endsAt && effectiveDentist && availability ? availabilityWarnings({ dentist_id: effectiveDentist, starts_at: startsAt, ends_at: endsAt }, availability) : []),
    [startsAt, endsAt, effectiveDentist, availability],
  );

  const readOnly = !can.agendaWrite;

  function onType(id: string) {
    setTypeId(id);
    // Le type impose sa durée (modifiable ensuite).
    const ty = types?.find((x) => x.id === id);
    setDuration(ty ? ty.duration_minutes : effectiveDuration);
  }

  async function conflictMessage(c: Conflict<Appointment>) {
    return t(c.reason === "dentist" ? "agenda.form.conflictDentist" : "agenda.form.conflictChair", {
      from: formatTime(c.appointment.starts_at, locale, tz),
      to: formatTime(c.appointment.ends_at, locale, tz),
      who: await appointmentLabelLocal(c.appointment),
    });
  }

  async function submit() {
    if (saving) return;
    setError(null);
    if (!freeLabel && !patientId) return setError(t("agenda.form.patientOrTitle"));
    if (freeLabel && !title.trim()) return setError(t("agenda.form.patientOrTitle"));
    if (!startsAt || !endsAt) return setError(t("agenda.form.endAfterStart"));
    if (!effectiveDentist) return setError(t("agenda.noDentist"));
    setSaving(true);
    try {
      const res = await saveAppointment(
        cabinetId,
        {
          patient_id: freeLabel ? null : patientId,
          title: freeLabel ? title.trim() : null,
          type_id: effectiveType || null,
          dentist_id: effectiveDentist,
          chair_id: effectiveChair || null,
          starts_at: startsAt,
          ends_at: endsAt,
          notes: notes.trim() || null,
          ...(appointment ? {} : { status: "scheduled" as const, source: "staff" as const, created_by: user?.id ?? null }),
        },
        current ?? undefined,
      );
      if (!res.ok) {
        setError(await conflictMessage(res.conflicts[0]));
        return;
      }
      toast(appointment ? t("agenda.form.saved") : t("agenda.form.created"));
      if (!appointment && (await appointmentHasWhatsApp(res.appointment.patient_id))) {
        setCreatedId(res.appointment.id);
        return;
      }
      onDone();
    } finally {
      setSaving(false);
    }
  }

  async function quickStatus(s: Status) {
    if (!current) return;
    const res = await changeStatus(cabinetId, current, s);
    if (!res.ok) {
      toast(await conflictMessage(res.conflicts[0]), "error");
      return;
    }
    toast(t("agenda.form.statusChanged", { status: t(`agenda.status.${s}`) }), "info");
  }

  const disabled = readOnly;
  // « Terminer la consultation » : RDV avec patient, dentiste pouvant facturer.
  const canConsult =
    !!current?.patient_id && can.clinicalWrite && can.billingWrite && current.status !== "cancelled" && current.status !== "no_show";
  const formId = `appointment-${appointment?.id ?? "new"}`;

  if (createdId) return <AppointmentCreated appointmentId={createdId} onDone={onDone} />;

  return (
    <div className="flex flex-col gap-4">
      {current && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(current.status)}>{t(`agenda.status.${current.status}`)}</Badge>
            {current.source === "online" && <Badge tone="info">{t("agenda.online")}</Badge>}
            {current.arrived_at && (
              <span className="text-xs text-muted">{t("agenda.form.arrivedAt", { time: formatTime(current.arrived_at, locale, tz) })}</span>
            )}
            {current.patient_id && (
              <Link href={`/app/patients/fiche?id=${current.patient_id}`} className="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline">
                <ExternalLink className="size-3.5" />
                {t("agenda.form.openFile")}
              </Link>
            )}
          </div>
          {(!readOnly || canConsult) && (
            <div className="flex flex-wrap gap-2">
              {canConsult && current.patient_id && <FinishConsultationButton patientId={current.patient_id} appointmentId={current.id} />}
              <AppointmentWhatsApp appointmentId={current.id} />
              {!readOnly &&
                nextStatuses(current.status)
                .sort((a, b) => Number(b === primaryNextStatus(current.status)) - Number(a === primaryNextStatus(current.status)))
                .map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={s === primaryNextStatus(current.status) && !canConsult ? "primary" : s === "cancelled" || s === "no_show" ? "ghost" : "secondary"}
                    onClick={() => quickStatus(s)}
                  >
                    {t(`agenda.action.${s}`)}
                  </Button>
                ))}
            </div>
          )}
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-muted">{t("agenda.reminders.title")}</div>
            <ReminderStatus appointmentId={current.id} />
          </div>
        </div>
      )}

      {readOnly && <p className="text-sm text-muted">{t("agenda.form.readOnly")}</p>}

      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          // Entrée enregistre aussi depuis une liste déroulante (pas depuis les notes ni un bouton).
          const el = e.target as HTMLElement;
          if (e.key === "Enter" && !e.shiftKey && el.tagName === "SELECT") {
            e.preventDefault();
            void submit();
          }
        }}
      >
      <fieldset disabled={disabled} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{freeLabel ? t("agenda.form.title") : t("agenda.form.patient")}</span>
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setFreeLabel((v) => !v)}>
              {freeLabel ? t("agenda.form.usePatient") : t("agenda.form.useFreeLabel")}
            </button>
          </div>
          {freeLabel ? (
            <Input aria-label={t("agenda.form.title")} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("agenda.form.freeLabel")} />
          ) : (
            <PatientPicker value={patientId} onChange={(p) => setPatientId(p?.id ?? null)} autoFocus={!appointment} showRecent />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("agenda.form.type")}>
            {(p) => (
              <Select {...p} value={effectiveType} onChange={(e) => onType(e.target.value)}>
                <option value="">{t("agenda.form.noType")}</option>
                {types?.map((ty) => (
                  <option key={ty.id} value={ty.id}>
                    {ty.name} · {formatDuration(ty.duration_minutes)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("agenda.dentist")} required>
            {(p) => (
              <Select {...p} value={effectiveDentist} onChange={(e) => setDentistId(e.target.value)}>
                {dentists?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("agenda.chair")}>
            {(p) => (
              <Select {...p} value={effectiveChair} onChange={(e) => setChairId(e.target.value)}>
                <option value="">{t("agenda.noChair")}</option>
                {chairs?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("agenda.form.date")} required>
            {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label={t("agenda.form.start")} required hint={t("agenda.form.endsAt", { time: minutesToHHMM(endMin) })}>
            {(p) => <TimeSelect {...p} aria-label={t("agenda.form.start")} value={start} onChange={setStart} />}
          </Field>
          <Field label={t("agenda.form.durationLabel")} required error={validTimes ? undefined : t("agenda.form.endAfterStart")}>
            {(p) => (
              <Select {...p} value={effectiveDuration} onChange={(e) => setDuration(Number(e.target.value))}>
                {durationOptions(effectiveDuration).map((d) => (
                  <option key={d} value={d}>
                    {formatDuration(d)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field label={t("agenda.form.notes")}>
          {(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />}
        </Field>
      </fieldset>
      </form>

      {conflicts && conflicts.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          {conflicts.map((c) => (
            <p key={c.appointment.id}>
              {t(c.reason === "dentist" ? "agenda.form.conflictDentist" : "agenda.form.conflictChair", {
                from: formatTime(c.appointment.starts_at, locale, tz),
                to: formatTime(c.appointment.ends_at, locale, tz),
                who: c.who,
              })}
            </p>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          <AlertTriangle className="size-4 shrink-0" />
          <div>
            {warnings.map((w) => (
              <p key={w}>{t(w === "outside_hours" ? "agenda.form.outsideHours" : "agenda.form.timeOff")}</p>
            ))}
          </div>
        </div>
      )}
      {error && !(conflicts && conflicts.length) && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {!readOnly && (
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={onDone}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} loading={saving} disabled={!validTimes || !!(conflicts && conflicts.length)} title={t("agenda.form.enterHint")}>
            {warnings.length ? t("agenda.form.saveAnyway") : t("agenda.form.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
