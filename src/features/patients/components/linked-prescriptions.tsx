"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, Plus, Printer } from "lucide-react";
import type { Row } from "@/lib/local/db";
import { formatDate } from "@/lib/format";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { parseRxItems, rxDrugLabel } from "../lib/clinical";
import { prescriptionsForInvoice } from "../lib/consultation";
import { usePatientPrescriptions } from "../lib/hooks";
import { RxDialog, type RxDialogTarget } from "./rx-dialog";

/**
 * Bloc « Ordonnance associée » de la page facture (dentistes seulement : les ordonnances ne
 * sont lisibles que par eux). Les médicaments ne sont pas facturés.
 */
export function LinkedPrescriptions({ invoice }: { invoice: Row<"invoices"> }) {
  const { can } = useCabinet();
  if (!can.clinical) return null;
  return <Linked invoice={invoice} />;
}

function Linked({ invoice }: { invoice: Row<"invoices"> }) {
  const { t, locale } = useI18n();
  const cabinetId = useCabinetId();
  const { can, cabinet } = useCabinet();
  const all = usePatientPrescriptions(cabinetId, invoice.patient_id);
  const [target, setTarget] = useState<RxDialogTarget | null>(null);
  const linked = all ? prescriptionsForInvoice(all, invoice) : [];

  return (
    <Card className="no-print">
      <CardHeader
        title={t("billing.rx.title")}
        actions={
          can.clinicalWrite && (
            <Button size="sm" variant="secondary" onClick={() => setTarget({ invoiceId: invoice.id, appointmentId: invoice.appointment_id })}>
              <Plus className="size-4" />
              {t("billing.rx.create")}
            </Button>
          )
        }
      />
      <CardBody className="flex flex-col gap-2">
        {linked.length === 0 ? (
          <p className="text-sm text-muted">{t("billing.rx.none")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {linked.map((rx) => (
              <li key={rx.id} className="flex flex-col gap-1 rounded-lg border border-border p-2 text-sm">
                <div className="font-medium">{t("billing.rx.of", { date: formatDate(rx.issued_at, locale, cabinet?.timezone) })}</div>
                <div className="text-xs text-muted">
                  {parseRxItems(rx.items)
                    .map((i) => rxDrugLabel(i))
                    .join(", ")}
                </div>
                <div className="flex gap-2">
                  <Link href={`/app/patients/fiche?id=${rx.patient_id}&tab=prescriptions`} className={buttonClass("ghost", "sm")}>
                    <Eye className="size-4" />
                    {t("billing.rx.view")}
                  </Link>
                  <Link href={`/app/patients/ordonnance?id=${rx.id}`} className={buttonClass("secondary", "sm")}>
                    <Printer className="size-4" />
                    {t("billing.rx.print")}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs italic text-muted">{t("billing.rx.notBilled")}</p>
      </CardBody>
      <RxDialog patientId={invoice.patient_id} target={target} onClose={() => setTarget(null)} />
    </Card>
  );
}
