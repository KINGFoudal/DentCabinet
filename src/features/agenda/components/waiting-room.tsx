"use client";

import { useMemo, useState } from "react";
import { Clock, Sofa } from "lucide-react";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { dayBounds, todayISO } from "@/lib/dates";
import { formatDate, formatTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader, PageSpinner } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { statusTone, waitingMinutes, type Status } from "../lib/grid";
import { appointmentLabel, appointmentLabelLocal, useAppointmentTypes, useAppointmentsInRange, useChairs, useDentists, type Appointment } from "../lib/data";
import { changeStatus } from "../lib/actions";
import { useNow } from "../lib/hooks";
import { AppointmentDialog } from "./appointment-dialog";
import { FinishConsultationButton } from "@/features/patients/components/consultation";

type Group = { key: string; title: string; items: Appointment[]; actions: Status[] };

export function WaitingRoom() {
  const { t, locale } = useI18n();
  const cabinetId = useCabinetId();
  const { cabinet, can } = useCabinet();
  const toast = useToast();
  const tz = cabinet?.timezone ?? "Africa/Conakry";
  const now = useNow(30_000);
  const today = todayISO(tz, now);
  const [start, end] = dayBounds(today, tz);
  const data = useAppointmentsInRange(start, end);
  const dentists = useDentists();
  const chairs = useChairs();
  const types = useAppointmentTypes();
  const [open, setOpen] = useState<Appointment | null>(null);

  const dentistName = useMemo(() => new Map((dentists ?? []).map((d) => [d.id, d.name])), [dentists]);
  const chairName = useMemo(() => new Map((chairs ?? []).map((c) => [c.id, c.name])), [chairs]);
  const typeMap = useMemo(() => new Map((types ?? []).map((x) => [x.id, x])), [types]);

  const groups: Group[] = useMemo(() => {
    const list = [...(data?.appts ?? [])].filter((a) => a.starts_at >= start).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const by = (...s: string[]) => list.filter((a) => s.includes(a.status));
    return [
      {
        key: "waiting",
        title: t("agenda.waiting.waiting"),
        items: by("arrived").sort((a, b) => (a.arrived_at ?? "").localeCompare(b.arrived_at ?? "")),
        actions: ["in_treatment", "done"],
      },
      { key: "treatment", title: t("agenda.waiting.inTreatment"), items: by("in_treatment"), actions: ["done"] },
      { key: "expected", title: t("agenda.waiting.expected"), items: by("scheduled", "confirmed"), actions: ["arrived", "no_show"] },
      { key: "done", title: t("agenda.waiting.done"), items: by("done"), actions: [] },
      { key: "absent", title: t("agenda.waiting.absent"), items: by("cancelled", "no_show"), actions: [] },
    ];
  }, [data, start, t]);

  if (!data) return <PageSpinner />;

  async function act(a: Appointment, s: Status) {
    const res = await changeStatus(cabinetId, a, s);
    if (!res.ok) {
      const c = res.conflicts[0];
      const who = await appointmentLabelLocal(c.appointment);
      const key = c.reason === "dentist" ? "agenda.form.conflictDentist" : "agenda.form.conflictChair";
      toast(t(key, { from: formatTime(c.appointment.starts_at, locale, tz), to: formatTime(c.appointment.ends_at, locale, tz), who }), "error");
    } else toast(t("agenda.form.statusChanged", { status: t(`agenda.status.${s}`) }), "info");
  }

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <PageHeader title={t("agenda.waiting.title")} subtitle={t("agenda.waiting.subtitle", { date: formatDate(start, locale, tz) })} />
      {total === 0 ? (
        <Card>
          <EmptyState icon={<Sofa />} title={t("agenda.waiting.empty")} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups
            .filter((g) => g.items.length || g.key === "waiting" || g.key === "treatment")
            .map((g) => (
              <Card key={g.key} className={cn(g.key === "waiting" && "border-warning/40")}>
                <CardHeader
                  title={
                    <span className="inline-flex items-center gap-2">
                      {g.title}
                      <Badge tone={g.key === "waiting" ? "warning" : "neutral"}>{g.items.length}</Badge>
                    </span>
                  }
                />
                {g.items.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted">{t("agenda.waiting.nobody")}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {g.items.map((a) => {
                      const wait = a.status === "arrived" ? waitingMinutes(a.arrived_at, now) : null;
                      const late =
                        (a.status === "scheduled" || a.status === "confirmed") && new Date(a.starts_at) < now
                          ? Math.floor((now.getTime() - new Date(a.starts_at).getTime()) / 60000)
                          : null;
                      const type = a.type_id ? typeMap.get(a.type_id) : undefined;
                      // Le dentiste qui facture termine la consultation (facture + ordonnance) plutôt que « Terminé ».
                      const consult = !!a.patient_id && (a.status === "arrived" || a.status === "in_treatment") && can.clinicalWrite && can.billingWrite;
                      return (
                        <li key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                          <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => setOpen(a)}>
                            <span className="w-12 shrink-0 pt-0.5 font-semibold tabular-nums">{formatTime(a.starts_at, locale, tz)}</span>
                            <span className="min-w-0">
                              <span className="flex items-center gap-2">
                                {type && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: type.color }} />}
                                <span className="truncate font-medium">{appointmentLabel(a, data.patients)}</span>
                              </span>
                              <span className="block truncate text-xs text-muted">
                                {[type?.name, dentistName.get(a.dentist_id), a.chair_id && chairName.get(a.chair_id)].filter(Boolean).join(" · ")}
                              </span>
                              {wait !== null && (
                                <span className={cn("mt-0.5 inline-flex items-center gap-1 text-xs font-medium", wait >= 30 ? "text-danger" : "text-warning")}>
                                  <Clock className="size-3.5" />
                                  {t("agenda.waiting.waitedFor", { minutes: wait })}
                                </span>
                              )}
                              {late !== null && late > 0 && (
                                <span className="mt-0.5 block text-xs text-danger">{t("agenda.waiting.late", { minutes: late })}</span>
                              )}
                              {a.status === "in_treatment" && a.arrived_at && (
                                <span className="mt-0.5 block text-xs text-muted">{t("agenda.form.arrivedAt", { time: formatTime(a.arrived_at, locale, tz) })}</span>
                              )}
                            </span>
                          </button>
                          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                            {consult && a.patient_id && <FinishConsultationButton patientId={a.patient_id} appointmentId={a.id} className="min-h-10 sm:min-h-8" />}
                            {g.actions.length === 0 && <Badge tone={statusTone(a.status)}>{t(`agenda.status.${a.status}`)}</Badge>}
                            {can.agendaWrite &&
                              g.actions.map((s) => (
                                <Button key={s} size="sm" variant={s === "no_show" || (consult && s === "done") ? "secondary" : "primary"} className="min-h-10 sm:min-h-8" onClick={() => act(a, s)}>
                                  {t(`agenda.action.${s}`)}
                                </Button>
                              ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            ))}
        </div>
      )}
      <AppointmentDialog open={!!open} onClose={() => setOpen(null)} appointment={open} />
    </>
  );
}
