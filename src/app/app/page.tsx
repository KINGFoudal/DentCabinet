"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Calendar, CalendarPlus, Check, ChevronRight, CreditCard, Sofa, UserPlus, Users, Wallet } from "lucide-react";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { localDb } from "@/lib/local/db";
import { dayBounds, todayISO } from "@/lib/dates";
import { formatGNF, formatTime, fullName } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useShortcuts } from "@/components/app/shortcuts";
import { primaryNextStatus, statusTone, type Status } from "@/features/agenda/lib/grid";
import { changeStatus } from "@/features/agenda/lib/actions";
import { useNow } from "@/features/agenda/lib/hooks";
import type { Appointment } from "@/features/agenda/lib/data";
import { FinishConsultationButton } from "@/features/patients/components/consultation";

export default function DashboardPage() {
  const cabinetId = useCabinetId();
  const { can, cabinet } = useCabinet();
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const tz = cabinet?.timezone ?? "Africa/Conakry";
  const now = useNow();
  const [start, end] = dayBounds(todayISO(tz, now), tz);

  const data = useLiveQuery(async () => {
    const db = localDb();
    const appts = (
      await db.appointments.where("[cabinet_id+starts_at]").between([cabinetId, start], [cabinetId, end], true, false).toArray()
    ).filter((a) => !a.deleted_at && a.status !== "cancelled");
    const patients = await db.patients.where("cabinet_id").equals(cabinetId).filter((p) => !p.deleted_at).count();
    const payments = (
      await db.payments.where("[cabinet_id+paid_at]").between([cabinetId, start], [cabinetId, end], true, false).toArray()
    ).filter((p) => !p.deleted_at && p.status === "succeeded");
    const patientIds = [...new Set(appts.map((a) => a.patient_id).filter(Boolean))] as string[];
    const names = new Map((await db.patients.bulkGet(patientIds)).filter(Boolean).map((p) => [p!.id, fullName(p)]));
    const types = new Map((await db.appointment_types.where("cabinet_id").equals(cabinetId).toArray()).map((x) => [x.id, x]));
    return {
      appts: appts.sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      waiting: appts.filter((a) => a.status === "arrived").length,
      patients,
      revenue: payments.reduce((s, p) => s + Number(p.amount_gnf), 0),
      names,
      types,
    };
  }, [cabinetId, start, end]);

  useShortcuts({ n: () => can.agendaWrite && router.push("/app/agenda?nouveau=1") });

  const stats = [
    { label: t("nav.agenda"), value: data?.appts.length ?? "…", icon: Calendar, href: "/app/agenda" },
    { label: t("nav.waitingRoom"), value: data?.waiting ?? "…", icon: Sofa, href: "/app/salle-attente" },
    { label: t("nav.patients"), value: data?.patients ?? "…", icon: Users, href: "/app/patients" },
    ...(can.billingRead
      ? [{ label: t("nav.billing"), value: data ? formatGNF(data.revenue, locale) : "…", icon: CreditCard, href: "/app/facturation" }]
      : []),
  ];

  const actions = [
    ...(can.agendaWrite ? [{ href: "/app/agenda?nouveau=1", label: t("dashboard.newAppointment"), icon: CalendarPlus, key: "n" }] : []),
    ...(can.patientsWrite ? [{ href: "/app/patients?nouveau=1", label: t("dashboard.newPatient"), icon: UserPlus, key: "p" }] : []),
    ...(can.billingWrite ? [{ href: "/app/facturation?onglet=impayes", label: t("dashboard.collect"), icon: Wallet, key: null }] : []),
  ];

  // Prochains RDV : pas encore terminés et pas encore finis à l'heure qu'il est.
  const nowIso = now.toISOString();
  const upcoming = (data?.appts ?? []).filter((a) => a.status !== "done" && a.status !== "no_show" && (a.ends_at >= nowIso || a.status === "arrived" || a.status === "in_treatment"));
  const pastCount = (data?.appts.length ?? 0) - upcoming.length;

  async function quick(a: Appointment, s: Status) {
    const res = await changeStatus(cabinetId, a, s);
    if (!res.ok) return toast(t("agenda.form.statusRefused"), "error");
    toast(t("agenda.form.statusChanged", { status: t(`agenda.status.${s}`) }), "info");
  }

  return (
    <>
      <PageHeader title={t("nav.dashboard")} subtitle={cabinet?.name} />

      {actions.length > 0 && (
        <nav aria-label={t("dashboard.quickActions")} className="mb-4 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          {actions.map((a, i) => (
            <Link
              key={a.href}
              href={a.href}
              title={a.key ? `${a.label} (${a.key})` : a.label}
              className={buttonClass(i === 0 ? "primary" : "secondary", "lg", "h-auto min-h-12 flex-col gap-1 px-2 py-2 text-center text-sm sm:flex-row sm:gap-2 sm:px-5")}
            >
              <a.icon className="size-5 shrink-0" />
              <span className="leading-tight">{a.label}</span>
            </Link>
          ))}
        </nav>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="h-full p-4 hover:border-primary">
              <s.icon className="size-5 text-primary" />
              <div className="mt-2 text-xl font-semibold">{s.value}</div>
              <div className="text-sm text-muted">{s.label}</div>
            </Card>
          </Link>
        ))}
      </div>
      <Card className="mt-4">
        <CardHeader
          title={t("dashboard.upcoming")}
          actions={
            <Link href="/app/agenda" className="text-sm text-primary hover:underline">
              {t("dashboard.openAgenda")}
            </Link>
          }
        />
        <CardBody className="p-0">
          {data && data.appts.length === 0 ? (
            <EmptyState icon={<Calendar />} title={t("dashboard.noAppointments")} />
          ) : data && upcoming.length === 0 ? (
            <EmptyState icon={<Check />} title={t("dashboard.allDone")} />
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.map((a) => {
                // En soins : le dentiste qui facture termine la consultation (facture + ordonnance).
                const consult = !!a.patient_id && a.status === "in_treatment" && can.clinicalWrite && can.billingWrite;
                const next = can.agendaWrite && !consult ? primaryNextStatus(a.status) : null;
                const type = a.type_id ? data?.types.get(a.type_id) : undefined;
                return (
                  <li key={a.id} className="flex items-center gap-2 pr-2 text-sm">
                    <Link href={`/app/agenda?rdv=${a.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 hover:bg-primary-soft">
                      <span className="w-12 shrink-0 font-medium tabular-nums">{formatTime(a.starts_at, locale, tz)}</span>
                      {type && <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: type.color }} />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{(a.patient_id && data?.names.get(a.patient_id)) || a.title || "—"}</span>
                        {type && <span className="block truncate text-xs text-muted">{type.name}</span>}
                      </span>
                      <Badge tone={statusTone(a.status)} className="hidden sm:inline-flex">
                        {t(`agenda.status.${a.status}`)}
                      </Badge>
                      {!next && !consult && <ChevronRight className="size-4 shrink-0 text-muted" />}
                    </Link>
                    {consult && a.patient_id && <FinishConsultationButton patientId={a.patient_id} appointmentId={a.id} className="shrink-0 px-2" compact />}
                    {next && (
                      <button
                        type="button"
                        onClick={() => void quick(a, next)}
                        className={buttonClass("secondary", "sm", "shrink-0 px-2")}
                        aria-label={`${t(`agenda.action.${next}`)} : ${(a.patient_id && data?.names.get(a.patient_id)) || a.title || ""}`}
                      >
                        <Check className="size-4" />
                        {t(`agenda.action.${next}`)}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {pastCount > 0 && (
            <Link href="/app/agenda" className="block border-t border-border px-4 py-2 text-xs text-muted hover:text-primary">
              {t("dashboard.past", { count: pastCount })}
            </Link>
          )}
        </CardBody>
      </Card>
    </>
  );
}
