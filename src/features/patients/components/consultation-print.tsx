"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Printer } from "lucide-react";
import { localDb } from "@/lib/local/db";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Button, buttonClass } from "@/components/ui/button";
import { PageSpinner } from "@/components/ui/card";
import { useInvoice } from "@/features/billing/data";
import { PrintStyles } from "@/features/billing/components/document";
import { InvoiceSheet } from "@/features/billing/components/invoice-sheet";
import { PrescriptionSheet, RxPrintStyles } from "./prescription-print";

/**
 * Impression des documents d'une consultation : facture puis ordonnance (saut de page).
 * Lit ?patient=, ?invoice=, ?rx= ; à rendre sous <Suspense>.
 */
export function ConsultationPrint() {
  const params = useSearchParams();
  const { t } = useI18n();
  const cabinetId = useCabinetId();
  const { can } = useCabinet();
  const patientId = params.get("patient");
  const invoiceId = params.get("invoice");
  const rxId = params.get("rx");
  const invoice = useInvoice(cabinetId, invoiceId);
  const rx = useLiveQuery(async () => {
    if (!rxId || !can.clinical) return null;
    const db = localDb();
    const row = await db.prescriptions.get(rxId);
    if (!row || row.cabinet_id !== cabinetId || row.deleted_at) return null;
    return { row, patient: (await db.patients.get(row.patient_id)) ?? null };
  }, [rxId, cabinetId, can.clinical]);

  if (invoice === undefined || rx === undefined) return <PageSpinner />;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PrintStyles />
      <RxPrintStyles />
      <style>{`@media print { .consult-break { break-before: page; } }`}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link href={patientId ? `/app/patients/fiche?id=${patientId}` : "/app/patients"} className={buttonClass("ghost", "sm")}>
          <ArrowLeft className="size-4" />
          {t("patients.consult.backToFile")}
        </Link>
        <h1 className="text-lg font-semibold">{t("patients.consult.printTitle")}</h1>
        <Button onClick={() => window.print()} disabled={!invoice && !rx}>
          <Printer className="size-4" />
          {t("patients.consult.printBoth")}
        </Button>
      </div>
      {!invoice && !rx && <p className="p-6 text-center text-muted">{t("patients.consult.nothingToPrint")}</p>}
      {invoice && <InvoiceSheet view={invoice} />}
      {rx && (
        <div className={invoice ? "consult-break" : undefined}>
          <PrescriptionSheet rx={rx.row} patient={rx.patient} />
        </div>
      )}
    </div>
  );
}
