"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Calendar, CreditCard, Users, Sofa } from "lucide-react";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { localDb } from "@/lib/local/db";
import { dayBounds, todayISO } from "@/lib/dates";
import { formatGNF, formatTime, fullName } from "@/lib/format";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";

export default function DashboardPage() {
  const cabinetId = useCabinetId();
  const { can, cabinet } = useCabinet();
  const { t, locale } = useI18n();
  const tz = cabinet?.timezone ?? "Africa/Conakry";
  const [start, end] = dayBounds(todayISO(tz), tz);

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
    return {
      appts: appts.sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      waiting: appts.filter((a) => a.status === "arrived").length,
      patients,
      revenue: payments.reduce((s, p) => s + Number(p.amount_gnf), 0),
      names,
    };
  }, [cabinetId, start, end]);

  const stats = [
    { label: t("nav.agenda"), value: data?.appts.length ?? "…", icon: Calendar, href: "/app/agenda" },
    { label: t("nav.waitingRoom"), value: data?.waiting ?? "…", icon: Sofa, href: "/app/salle-attente" },
    { label: t("nav.patients"), value: data?.patients ?? "…", icon: Users, href: "/app/patients" },
    ...(can.billingRead
      ? [{ label: t("nav.billing"), value: data ? formatGNF(data.revenue, locale) : "…", icon: CreditCard, href: "/app/facturation" }]
      : []),
  ];

  return (
    <>
      <PageHeader title={t("nav.dashboard")} subtitle={cabinet?.name} />
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
        <CardHeader title={t("nav.agenda")} />
        <CardBody className="p-0">
          {data && data.appts.length === 0 ? (
            <EmptyState icon={<Calendar />} title="—" />
          ) : (
            <ul className="divide-y divide-border">
              {data?.appts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="w-14 font-medium">{formatTime(a.starts_at, locale, tz)}</span>
                  <span className="flex-1 truncate">{(a.patient_id && data.names.get(a.patient_id)) || a.title || "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
