"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Printer } from "lucide-react";
import { localDb } from "@/lib/local/db";
import { ageFrom, formatDate, formatPhone, fullName } from "@/lib/format";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { RequirePermission } from "@/components/app/app-gate";
import { Button, buttonClass } from "@/components/ui/button";
import { PageSpinner } from "@/components/ui/card";
import { parseRxItems } from "../lib/clinical";
import { staffName, useStaffNames } from "../lib/hooks";

/** Ordonnance imprimable avec l'en-tête du cabinet. */
export function PrescriptionPrint({ id }: { id: string | null }) {
  const { can } = useCabinet();
  return (
    <RequirePermission allowed={can.clinical}>
      <PrintBody id={id} />
    </RequirePermission>
  );
}

function PrintBody({ id }: { id: string | null }) {
  const { t, locale } = useI18n();
  const cabinetId = useCabinetId();
  const { cabinet } = useCabinet();
  const names = useStaffNames(cabinetId);
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const db = localDb();
    const rx = await db.prescriptions.get(id);
    if (!rx || rx.cabinet_id !== cabinetId || rx.deleted_at) return null;
    const patient = await db.patients.get(rx.patient_id);
    return { rx, patient: patient ?? null };
  }, [id, cabinetId]);

  if (data === undefined) return <PageSpinner />;
  if (!data) return <p className="p-6 text-center text-muted">{t("patients.rx.notFound")}</p>;

  const { rx, patient } = data;
  const items = parseRxItems(rx.items);
  const tz = cabinet?.timezone;
  const age = ageFrom(patient?.birth_date);

  return (
    <div className="rx-print mx-auto flex w-full max-w-3xl flex-col gap-4">
      <style>{`
        @media print {
          @page { size: A4; margin: 16mm; }
          main { padding: 0 !important; }
          .rx-sheet { border: none !important; box-shadow: none !important; padding: 0 !important; }
        }
      `}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link href={patient ? `/app/patients/fiche?id=${patient.id}&tab=prescriptions` : "/app/patients"} className={buttonClass("ghost", "sm")}>
          <ArrowLeft className="size-4" />
          {t("common.back")}
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          {t("common.print")}
        </Button>
      </div>

      <article className="rx-sheet flex min-h-[70vh] flex-col rounded-xl border border-border bg-surface p-6 text-text print:min-h-0 print:bg-white print:text-black sm:p-10">
        <header className="flex flex-col gap-1 border-b-2 border-primary pb-4 print:border-black">
          <h1 className="text-2xl font-bold text-primary print:text-black">{cabinet?.name}</h1>
          {(cabinet?.address || cabinet?.city) && <p className="text-sm">{[cabinet?.address, cabinet?.city].filter(Boolean).join(", ")}</p>}
          <p className="text-sm">{[formatPhone(cabinet?.phone), cabinet?.email].filter(Boolean).join(" · ")}</p>
        </header>

        <section className="mt-5 grid gap-3 text-sm sm:grid-cols-2 print:grid-cols-2">
          <div>
            <p className="text-xs uppercase text-muted print:text-black">{t("patients.rx.practitioner")}</p>
            <p className="font-semibold">{staffName(names, rx.dentist_id)}</p>
          </div>
          <div className="sm:text-right print:text-right">
            <p className="text-xs uppercase text-muted print:text-black">{t("patients.rx.date")}</p>
            <p className="font-semibold">{formatDate(rx.issued_at, locale, tz)}</p>
          </div>
          <div className="sm:col-span-2 print:col-span-2">
            <p className="text-xs uppercase text-muted print:text-black">{t("patients.rx.patient")}</p>
            <p className="font-semibold">
              {fullName(patient)}
              {age != null && <span className="font-normal"> — {t("patients.years", { count: age })}</span>}
            </p>
            {patient?.file_number && <p className="text-xs">{t("patients.fields.fileNumber")} : {patient.file_number}</p>}
          </div>
        </section>

        <h2 className="mt-8 text-center text-lg font-semibold uppercase tracking-widest">{t("patients.rx.title")}</h2>

        <ol className="mt-6 flex flex-col gap-5">
          {items.map((it, i) => (
            <li key={i} className="break-inside-avoid">
              <p className="font-semibold">
                {i + 1}. {it.drug}
              </p>
              {(it.dosage || it.duration) && (
                <p className="ml-5 text-sm">{[it.dosage, it.duration && `${t("patients.rx.duration")} : ${it.duration}`].filter(Boolean).join(" — ")}</p>
              )}
              {it.instructions && <p className="ml-5 text-sm italic">{it.instructions}</p>}
            </li>
          ))}
        </ol>

        {rx.notes && <p className="mt-6 whitespace-pre-wrap text-sm">{rx.notes}</p>}

        <footer className="mt-auto flex justify-end pt-16">
          <div className="w-56 border-t border-text pt-1 text-center text-xs print:border-black">{t("patients.rx.signature")}</div>
        </footer>
      </article>
    </div>
  );
}
