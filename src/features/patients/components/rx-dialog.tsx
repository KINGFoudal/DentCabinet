"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Printer } from "lucide-react";
import { localDb, type Row } from "@/lib/local/db";
import { mutate } from "@/lib/sync/mutate";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth/auth-provider";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { buildPrescription, emptyRxItem, parseRxItems, type RxItem } from "../lib/clinical";
import { RxEditor } from "./rx-editor";

type Rx = Row<"prescriptions">;

export type RxDialogTarget = {
  /** Ordonnance à modifier ; absente pour une création. */
  rx?: Rx | null;
  /** Lignes de départ d'une nouvelle ordonnance (dupliquer). */
  initialItems?: RxItem[];
  invoiceId?: string | null;
  appointmentId?: string | null;
};

/** Création / modification d'une ordonnance (fiche patient, facture). */
export function RxDialog({ patientId, target, onClose }: { patientId: string; target: RxDialogTarget | null; onClose: () => void }) {
  const { t } = useI18n();
  const existing = target?.rx ?? null;
  return (
    <Dialog open={target != null} onClose={onClose} size="xl" title={t(existing ? "patients.rx.editTitle" : "patients.rx.new")}>
      {target && <RxForm patientId={patientId} target={target} onClose={onClose} />}
    </Dialog>
  );
}

/** Factures du patient qu'une ordonnance peut référencer (ni supprimées ni annulées). */
export function usePatientInvoices(cabinetId: string, patientId: string) {
  return useLiveQuery(
    async () =>
      (await localDb().invoices.where("patient_id").equals(patientId).toArray())
        .filter((i) => i.cabinet_id === cabinetId && !i.deleted_at && i.status !== "cancelled")
        .sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.created_at.localeCompare(a.created_at)),
    [cabinetId, patientId],
  );
}

export function invoiceOptionLabel(t: (k: string, v?: Record<string, string | number>) => string, inv: Row<"invoices">, date: string) {
  return inv.number ? t("patients.rx.linkedInvoice", { number: inv.number }) : t("patients.rx.draftInvoice", { date });
}

function RxForm({ patientId, target, onClose }: { patientId: string; target: RxDialogTarget; onClose: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const cabinetId = useCabinetId();
  const { cabinet } = useCabinet();
  const { user } = useAuth();
  const existing = target.rx ?? null;
  const invoices = usePatientInvoices(cabinetId, patientId);
  const [items, setItems] = useState<RxItem[]>(() => {
    const parsed = existing ? parseRxItems(existing.items) : (target.initialItems ?? []);
    return parsed.length ? parsed : [{ ...emptyRxItem }];
  });
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [shared, setShared] = useState(existing?.shared_with_patient ?? true);
  const [invoiceId, setInvoiceId] = useState(existing ? (existing.invoice_id ?? "") : (target.invoiceId ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(print: boolean) {
    if (!user || saving) return;
    const built = buildPrescription({
      id: existing?.id,
      cabinetId,
      patientId,
      dentistId: user.id,
      items,
      notes,
      shared,
      invoiceId: invoiceId || null,
      appointmentId: existing ? existing.appointment_id : (target.appointmentId ?? null),
    });
    if (!built.row) return setError(t("patients.rx.atLeastOne"));
    setSaving(true);
    try {
      const row = await mutate("prescriptions", built.row);
      toast(t("patients.rx.saved"));
      onClose();
      if (print) router.push(`/app/patients/ordonnance?id=${row.id}`);
    } catch (e) {
      // Écriture locale refusée (IndexedDB plein ou indisponible...) : le dire au lieu de perdre l'ordonnance.
      console.error("[local write]", e);
      toast(t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-4"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void save(false);
        }
      }}
    >
      <RxEditor patientId={patientId} items={items} onChange={(l) => (setItems(l), setError(null))} allowReuse={!existing} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("patients.rx.notes")}>
          {(p) => <Textarea {...p} rows={2} className="!min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <div className="flex flex-col gap-3">
          {(invoices?.length ?? 0) > 0 && (
            <Field label={t("patients.rx.invoice")}>
              {(p) => (
                <Select {...p} value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                  <option value="">{t("patients.rx.noInvoice")}</option>
                  {invoices!.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {invoiceOptionLabel(t, inv, formatDate(`${inv.issue_date}T12:00:00Z`, locale, cabinet?.timezone))}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Checkbox label={t("patients.rx.shared")} checked={shared} onChange={(e) => setShared(e.target.checked)} />
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button variant="secondary" onClick={() => save(true)} loading={saving}>
          <Printer className="size-4" />
          {t("patients.rx.savePrint")}
        </Button>
        <Button onClick={() => save(false)} loading={saving}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
