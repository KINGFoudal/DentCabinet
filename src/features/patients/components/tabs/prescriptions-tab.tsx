"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Pencil, Pill, Plus, Printer, Trash2, X } from "lucide-react";
import { localDb, type Row } from "@/lib/local/db";
import { mutate, softDelete } from "@/lib/sync/mutate";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth/auth-provider";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cleanRxItems, emptyRxItem, parseRxItems, type RxItem } from "../../lib/clinical";
import { staffName, useStaffNames } from "../../lib/hooks";

type Rx = Row<"prescriptions">;

export function PrescriptionsTab({ patientId }: { patientId: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { can, cabinet } = useCabinet();
  const names = useStaffNames(cabinetId);
  const [editing, setEditing] = useState<Rx | "new" | null>(null);
  const [deleting, setDeleting] = useState<Rx | null>(null);
  const list = useLiveQuery(
    async () =>
      (
        await localDb()
          .prescriptions.where("patient_id")
          .equals(patientId)
          .filter((r) => r.cabinet_id === cabinetId && !r.deleted_at)
          .toArray()
      ).sort((a, b) => b.issued_at.localeCompare(a.issued_at)),
    [patientId, cabinetId],
  );

  return (
    <div className="flex flex-col gap-4">
      {can.clinicalWrite && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {t("patients.rx.new")}
          </Button>
        </div>
      )}
      {list && list.length === 0 ? (
        <Card>
          <EmptyState icon={<Pill />} title={t("patients.rx.empty")} />
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {list?.map((rx) => {
            const items = parseRxItems(rx.items);
            return (
              <div key={rx.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{formatDate(rx.issued_at, locale, cabinet?.timezone)}</span>
                    <span className="text-muted">· {staffName(names, rx.dentist_id)}</span>
                    {rx.shared_with_patient && <Badge tone="info">{t("patients.rx.sharedBadge")}</Badge>}
                  </div>
                  <p className="truncate text-sm text-muted">
                    {items.map((i) => i.drug).join(", ") || "—"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/app/patients/ordonnance?id=${rx.id}`} className={buttonClass("secondary", "sm")}>
                    <Printer className="size-4" />
                    {t("patients.rx.print")}
                  </Link>
                  {can.clinicalWrite && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(rx)} aria-label={t("common.edit")}>
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
      <RxDialog key={editing === "new" ? "new" : (editing?.id ?? "none")} patientId={patientId} rx={editing} onClose={() => setEditing(null)} />
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

function RxDialog({ patientId, rx, onClose }: { patientId: string; rx: Rx | "new" | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { user } = useAuth();
  const router = useRouter();
  const existing = rx && rx !== "new" ? rx : null;
  const [items, setItems] = useState<RxItem[]>(() => {
    const parsed = existing ? parseRxItems(existing.items) : [];
    return parsed.length ? parsed : [{ ...emptyRxItem }];
  });
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [shared, setShared] = useState(existing?.shared_with_patient ?? true);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, k: keyof RxItem, v: string) => setItems((l) => l.map((it, j) => (j === i ? { ...it, [k]: v } : it)));

  async function save(print: boolean) {
    const clean = cleanRxItems(items);
    if (!clean.length) return setError(t("patients.rx.atLeastOne"));
    if (!user) return;
    const row = await mutate("prescriptions", {
      ...(existing ? { id: existing.id } : { cabinet_id: cabinetId, patient_id: patientId, dentist_id: user.id, issued_at: new Date().toISOString() }),
      items: clean,
      notes: notes.trim() || null,
      shared_with_patient: shared,
    });
    toast(t("patients.rx.saved"));
    onClose();
    if (print) router.push(`/app/patients/ordonnance?id=${row.id}`);
  }

  return (
    <Dialog
      open={rx != null}
      onClose={onClose}
      size="lg"
      title={t(existing ? "patients.rx.editTitle" : "patients.rx.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="secondary" onClick={() => save(true)}>
            <Printer className="size-4" />
            {t("patients.rx.print")}
          </Button>
          <Button onClick={() => save(false)}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ol className="flex flex-col gap-3">
          {items.map((it, i) => (
            <li key={i} className="relative rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-primary">#{i + 1}</span>
                {items.length > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => setItems((l) => l.filter((_, j) => j !== i))} aria-label={t("patients.rx.removeLine")}>
                    <X className="size-4" />
                  </Button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={t("patients.rx.drug")} required className="sm:col-span-2">
                  {(p) => <Input {...p} value={it.drug} placeholder={t("patients.rx.drugPlaceholder")} onChange={(e) => update(i, "drug", e.target.value)} />}
                </Field>
                <Field label={t("patients.rx.dosage")}>
                  {(p) => <Input {...p} value={it.dosage} placeholder={t("patients.rx.dosagePlaceholder")} onChange={(e) => update(i, "dosage", e.target.value)} />}
                </Field>
                <Field label={t("patients.rx.duration")}>
                  {(p) => <Input {...p} value={it.duration} placeholder={t("patients.rx.durationPlaceholder")} onChange={(e) => update(i, "duration", e.target.value)} />}
                </Field>
                <Field label={t("patients.rx.instructions")} className="sm:col-span-2">
                  {(p) => <Input {...p} value={it.instructions} onChange={(e) => update(i, "instructions", e.target.value)} />}
                </Field>
              </div>
            </li>
          ))}
        </ol>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div>
          <Button size="sm" variant="secondary" onClick={() => setItems((l) => [...l, { ...emptyRxItem }])}>
            <Plus className="size-4" />
            {t("patients.rx.addLine")}
          </Button>
        </div>
        <Field label={t("patients.rx.notes")}>
          {(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <Checkbox label={t("patients.rx.shared")} checked={shared} onChange={(e) => setShared(e.target.checked)} />
      </div>
    </Dialog>
  );
}
