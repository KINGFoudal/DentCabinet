"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, PageSpinner } from "@/components/ui/card";
import { useBillingData } from "../data";
import { countsAsRevenue } from "../lib/totals";
import { Kpi, useBilling } from "./common";
import { InvoiceList, QuoteList } from "./document-lists";
import { NewDocumentDialog } from "./new-document-dialog";

/**
 * Onglet « Facturation » de la fiche patient (affiché par le module patients) :
 * devis, factures, solde du patient, création de devis et de factures.
 */
export function PatientBilling({ patientId }: { patientId: string }) {
  const { t, gnf, cabinetId, canWrite, can } = useBilling();
  const data = useBillingData(cabinetId, patientId);
  const [creating, setCreating] = useState<"invoice" | "quote" | null>(null);

  if (!can.billingRead) return null;
  if (!data) return <PageSpinner />;

  const counted = data.invoices.filter((v) => countsAsRevenue(v.figures.status));
  const invoiced = counted.reduce((s, v) => s + v.figures.total, 0);
  const paid = counted.reduce((s, v) => s + v.figures.paid, 0);
  const balance = counted.reduce((s, v) => s + v.figures.balance, 0);
  const provisional = data.invoices.some((v) => v.figures.provisional);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Kpi label={t("billing.patient.invoiced")} value={gnf(invoiced)} />
        <Kpi label={t("billing.patient.paid")} value={gnf(paid)} tone="success" />
        <Kpi label={t("billing.patient.balance")} value={gnf(balance)} tone={balance > 0 ? "danger" : undefined} />
      </div>
      {provisional && <p className="-mt-2 text-xs italic text-warning">{t("billing.kpi.provisional")}</p>}

      <Card>
        <CardHeader
          title={t("billing.tabs.invoices")}
          actions={
            canWrite && (
              <Button size="sm" onClick={() => setCreating("invoice")}>
                <Plus className="size-4" />
                {t("billing.newInvoice")}
              </Button>
            )
          }
        />
        <InvoiceList views={data.invoices} compact />
      </Card>

      <Card>
        <CardHeader
          title={t("billing.tabs.quotes")}
          actions={
            canWrite && (
              <Button size="sm" variant="secondary" onClick={() => setCreating("quote")}>
                <Plus className="size-4" />
                {t("billing.newQuote")}
              </Button>
            )
          }
        />
        <QuoteList views={data.quotes} compact />
      </Card>

      <NewDocumentDialog open={creating !== null} onClose={() => setCreating(null)} kind={creating ?? "invoice"} patientId={patientId} />
    </div>
  );
}
