"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarPlus } from "lucide-react";
import { localDb } from "@/lib/local/db";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { formatDate, formatTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { isActiveStatus, statusTone } from "../lib/grid";
import { useAppointmentTypes, useDentists, type Appointment } from "../lib/data";
import { useNow } from "../lib/hooks";
import { AppointmentDialog } from "./appointment-dialog";

/**
 * Onglet « Rendez-vous » de la fiche patient (affiché par le module patients) :
 * prochains rendez-vous, historique, création d'un rendez-vous pour ce patient.
 */
export function PatientAppointments({ patientId }: { patientId: string }) {
  const { t, locale } = useI18n();
  const cabinetId = useCabinetId();
  const { cabinet, can } = useCabinet();
  const tz = cabinet?.timezone ?? "Africa/Conakry";
  const now = useNow();
  const dentists = useDentists();
  const types = useAppointmentTypes();
  const [dialog, setDialog] = useState<{ appointment: Appointment | null } | null>(null);

  const appts = useLiveQuery(
    () =>
      localDb()
        .appointments.where("patient_id")
        .equals(patientId)
        .filter((a) => a.cabinet_id === cabinetId && !a.deleted_at)
        .toArray(),
    [patientId, cabinetId],
  );

  const { upcoming, history } = useMemo(() => {
    const iso = now.toISOString();
    const list = appts ?? [];
    return {
      upcoming: list.filter((a) => a.ends_at >= iso && isActiveStatus(a.status) && a.status !== "done").sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      history: list
        .filter((a) => !(a.ends_at >= iso && isActiveStatus(a.status) && a.status !== "done"))
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at)),
    };
  }, [appts, now]);

  const dentistName = new Map((dentists ?? []).map((d) => [d.id, d.name]));
  const typeMap = new Map((types ?? []).map((x) => [x.id, x]));

  const row = (a: Appointment) => {
    const type = a.type_id ? typeMap.get(a.type_id) : undefined;
    return (
      <li key={a.id}>
        <button type="button" onClick={() => setDialog({ appointment: a })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-primary-soft">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: type?.color ?? "var(--text-muted)" }} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {formatDate(a.starts_at, locale, tz)} · {formatTime(a.starts_at, locale, tz)}
            </span>
            <span className="block truncate text-xs text-muted">
              {[type?.name, dentistName.get(a.dentist_id) && t("agenda.patient.with", { name: dentistName.get(a.dentist_id)! })].filter(Boolean).join(" · ")}
            </span>
          </span>
          <Badge tone={statusTone(a.status)}>{t(`agenda.status.${a.status}`)}</Badge>
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={t("agenda.patient.upcoming")}
          actions={
            can.agendaWrite && (
              <Button size="sm" onClick={() => setDialog({ appointment: null })}>
                <CalendarPlus className="size-4" />
                {t("agenda.newAppointment")}
              </Button>
            )
          }
        />
        {upcoming.length ? (
          <ul className="divide-y divide-border">{upcoming.map(row)}</ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">{t("agenda.patient.noUpcoming")}</p>
        )}
      </Card>
      <Card>
        <CardHeader title={t("agenda.patient.history")} />
        {history.length ? (
          <ul className="divide-y divide-border">{history.map(row)}</ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">{t("agenda.patient.noHistory")}</p>
        )}
      </Card>
      <AppointmentDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        appointment={dialog?.appointment}
        defaults={{ patient_id: patientId }}
      />
    </div>
  );
}
