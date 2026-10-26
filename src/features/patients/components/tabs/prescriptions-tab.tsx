"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Copy, ListPlus, Pencil, Pill, Plus, Printer, Receipt, Trash2 } from "lucide-react";
import { localDb, type Row } from "@/lib/local/db";
import { softDelete } from "@/lib/sync/mutate";
import { formatDate } from "@/lib/format";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { duplicateRxItems, parseRxItems, rxDrugLabel } from "../../lib/clinical";
import { staffName, usePatientPrescriptions, useStaffNames } from "../../lib/hooks";
import { invoiceOptionLabel, RxDialog, type RxDialogTarget } from "../rx-dialog";
import { MedicationsDialog } from "../medications-dialog";

type Rx = Row<"prescriptions">;

export function PrescriptionsTab({ patientId }: { patientId: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { can, cabinet } = useCabinet();
  const names = useStaffNames(cabinetId);
  const [target, setTarget] = useState<RxDialogTarget | null>(null);
  const [deleting, setDeleting] = useState<Rx | null>(null);
  const [managing, setManaging] = useState(false);
  const list = usePatientPrescriptions(cabinetId, patientId);
  const invoices = useLiveQuery(
    async () => new Map((await localDb().invoices.where("patient_id").equals(patientId).toArray()).filter((i) => i.cabinet_id === cabinetId).map((i) => [i.id, i] as const)),
    [patientId, cabinetId],
  );
  const date = (d: string) => formatDate(d, locale, cabinet?.timezone);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => setManaging(true)}>
          <ListPlus className="size-4" />
          {t("patients.meds.manage")}
        </Button>
        {can.clinicalWrite && (
          <Button onClick={() => setTarget({})}>
            <Plus className="size-4" />
            {t("patients.rx.new")}
          </Button>
        )}
      </div>
      {list && list.length === 0 ? (
        <Card>
          <EmptyState icon={<Pill />} title={t("patients.rx.empty")} />
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {list?.map((rx) => {
            const items = parseRxItems(rx.items);
            const inv = rx.invoice_id ? invoices?.get(rx.invoice_id) : undefined;
            return (
              <div key={rx.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{date(rx.issued_at)}</span>
                    <span className="text-muted">· {staffName(names, rx.dentist_id)}</span>
                    {rx.shared_with_patient && <Badge tone="info">{t("patients.rx.sharedBadge")}</Badge>}
                    {inv && !inv.deleted_at && (
                      <Link href={`/app/facturation/facture?id=${inv.id}`} className="inline-flex items-center gap-1 text-xs text-primary underline">
                        <Receipt className="size-3.5" />
                        {invoiceOptionLabel(t, inv, formatDate(`${inv.issue_date}T12:00:00Z`, locale, cabinet?.timezone))}
                      </Link>
                    )}
                  </div>
                  <p className="truncate text-sm text-muted">{items.map((i) => rxDrugLabel(i)).join(", ") || "—"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/app/patients/ordonnance?id=${rx.id}`} className={buttonClass("secondary", "sm")}>
                    <Printer className="size-4" />
                    {t("patients.rx.print")}
                  </Link>
                  {can.clinicalWrite && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setTarget({ initialItems: duplicateRxItems(rx.items) })} aria-label={t("patients.rx.duplicate")} title={t("patients.rx.duplicate")}>
                        <Copy className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setTarget({ rx })} aria-label={t("common.edit")}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(rx)} aria-label={t("patients.rx.delete")}>
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}
      <RxDialog patientId={patientId} target={target} onClose={() => setTarget(null)} />
      <MedicationsDialog open={managing} onClose={() => setManaging(false)} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await softDelete("prescriptions", deleting.id);
          toast(t("patients.rx.deleted"));
        }}
        title={t("patients.rx.deleteTitle")}
        message={deleting ? parseRxItems(deleting.items).map((i) => i.drug).join(", ") : ""}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        danger
      />
    </div>
  );
}
