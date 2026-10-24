"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { Button, buttonClass } from "@/components/ui/button";
import { EmptyState, PageSpinner } from "@/components/ui/card";
import { formatDate, formatPhone, fullName } from "@/lib/format";
import { normalizeItems, type PortalPatient, type PortalPrescription } from "@/features/portal/lib/portal-data";
import type { PortalCabinet } from "@/features/portal/lib/types";
import { doctorLabel } from "@/features/portal/lib/schedule";
import { usePatientSession } from "./patient-portal";
import { LocaleSwitch } from "./portal-header";

type Loaded = { id: string; prescription: PortalPrescription; cabinet: PortalCabinet | undefined; patient: PortalPatient | undefined } | { id: string; missing: true };

/** Ordonnance imprimable (en-tête du cabinet), lue via RLS prescriptions_portal_read. */
export function PrescriptionPrint() {
  const { t, locale } = useI18n();
  const id = useSearchParams().get("id") ?? "";
  const { ready, user } = usePatientSession();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;
    const sb = supabase();
    Promise.all([
      sb
        .from("prescriptions")
        .select("id, cabinet_id, patient_id, dentist_id, notes, issued_at, items")
        .eq("id", id)
        .eq("shared_with_patient", true)
        .is("deleted_at", null)
        .maybeSingle(),
      sb.rpc("portal_cabinets"),
      sb.from("patients").select("id, cabinet_id, first_name, last_name, file_number").eq("portal_user_id", user.id),
    ]).then(([p, c, pts]) => {
      if (cancelled) return;
      const patient = pts.data?.find((x) => x.id === p.data?.patient_id);
      if (!p.data || !patient) return setLoaded({ id, missing: true });
      const cabinets = (Array.isArray(c.data) ? c.data : []) as unknown as PortalCabinet[];
      setLoaded({
        id,
        prescription: { ...p.data, items: normalizeItems(p.data.items) },
        cabinet: cabinets.find((x) => x.id === p.data!.cabinet_id),
        patient,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [user, id]);

  if (!ready) return <PageSpinner />;
  if (!id || (loaded && "missing" in loaded)) {
    return <EmptyState title={t("portal.prescriptions.notFound")} action={<Link href="/patient" className={buttonClass("secondary")}>{t("portal.back")}</Link>} />;
  }
  if (!loaded || loaded.id !== id || "missing" in loaded) return <PageSpinner />;

  const { prescription: rx, cabinet, patient } = loaded;
  const dentist = cabinet?.dentists.find((d) => d.id === rx.dentist_id)?.name;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5 print:max-w-none print:p-0">
      <div className="no-print mb-4 flex items-center gap-2">
        <Link href="/patient" className={buttonClass("ghost", "sm", "-ml-2")}>
          <ArrowLeft className="size-4" />
          {t("portal.back")}
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitch />
          <Button onClick={() => window.print()}>
            <Printer className="size-4" />
            {t("portal.prescriptions.print")}
          </Button>
        </div>
      </div>
      <article className="rounded-xl border border-border bg-surface p-6 print:rounded-none print:border-0 print:p-0">
        <header className="border-b border-border pb-4">
          <p className="text-lg font-semibold text-primary print:text-black">{cabinet?.name}</p>
          {(cabinet?.address || cabinet?.city) && <p className="text-sm">{[cabinet?.address, cabinet?.city].filter(Boolean).join(", ")}</p>}
          {cabinet?.phone && <p className="text-sm">{formatPhone(cabinet.phone)}</p>}
          {dentist && <p className="mt-1 text-sm font-medium">{doctorLabel(dentist, t)}</p>}
        </header>
        <div className="flex flex-wrap justify-between gap-2 py-4 text-sm">
          <p>{t("portal.prescriptions.patient", { name: fullName(patient) })}</p>
          <p>{t("portal.prescriptions.issuedOn", { date: formatDate(rx.issued_at, locale, cabinet?.timezone) })}</p>
        </div>
        <h1 className="mb-3 text-center text-lg font-semibold uppercase tracking-wide">{t("portal.prescriptions.title")}</h1>
        <ol className="flex flex-col gap-3">
          {rx.items.map((it, i) => (
            <li key={i} className="text-sm">
              <p className="font-semibold">
                {i + 1}. {it.drug}
              </p>
              {(it.dosage || it.duration) && <p>{[it.dosage, it.duration].filter(Boolean).join(" — ")}</p>}
              {it.instructions && <p className="text-muted print:text-black">{it.instructions}</p>}
            </li>
          ))}
        </ol>
        {rx.notes && <p className="mt-4 whitespace-pre-line border-t border-border pt-3 text-sm">{rx.notes}</p>}
        <div className="mt-12 flex justify-end">
          <div className="w-48 border-t border-border pt-1 text-center text-xs text-muted print:border-black print:text-black">{dentist}</div>
        </div>
      </article>
    </div>
  );
}
