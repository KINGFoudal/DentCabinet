"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDb, type Row } from "@/lib/local/db";
import { mutate } from "@/lib/sync/mutate";
import { ageFrom, formatGNF } from "@/lib/format";
import { useAuth } from "@/lib/auth/auth-provider";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import {
  defaultDentition,
  SURFACES,
  TOOTH_STATUSES,
  toggleSurface,
  toothRecordId,
  type Dentition,
  type Surface,
  type ToothStatus,
} from "../../lib/fdi";
import { lineTotal } from "../../lib/clinical";
import { ChartLegend, DentalChart, StatusSwatch, type ToothState } from "../dental-chart";

type PlanItem = Row<"treatment_plan_items">;

export function ChartTab({ patient }: { patient: Row<"patients"> }) {
  const { t } = useI18n();
  const cabinetId = useCabinetId();
  const records = useLiveQuery(
    () =>
      localDb()
        .tooth_records.where("patient_id")
        .equals(patient.id)
        .filter((r) => r.cabinet_id === cabinetId && !r.deleted_at)
        .toArray(),
    [patient.id, cabinetId],
  );
  const items = useLiveQuery(async () => {
    const db = localDb();
    const plans = await db.treatment_plans
      .where("patient_id")
      .equals(patient.id)
      .filter((p) => !p.deleted_at && p.status !== "cancelled")
      .toArray();
    if (!plans.length) return [] as PlanItem[];
    return db.treatment_plan_items
      .where("plan_id")
      .anyOf(plans.map((p) => p.id))
      .filter((i) => !i.deleted_at && i.tooth != null)
      .toArray();
  }, [patient.id]);

  const states = useMemo(() => {
    const map = new Map<number, ToothState & { id: string }>();
    for (const r of records ?? []) map.set(r.tooth, { id: r.id, status: r.status, surfaces: r.surfaces, notes: r.notes });
    return map;
  }, [records]);
  const planned = useMemo(() => new Set((items ?? []).filter((i) => i.status === "planned").map((i) => i.tooth!)), [items]);

  const [dentitionChoice, setDentition] = useState<Dentition | null>(null);
  const dentition = dentitionChoice ?? defaultDentition(ageFrom(patient.birth_date), [...states.keys()]);
  const [selected, setSelected] = useState<number | null>(null);

  const recorded = [...states.entries()].filter(([, s]) => s.status !== "healthy" || s.surfaces.length || s.notes).sort((a, b) => a[0] - b[0]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={t("patients.tabs.chart")}
          actions={
            <div role="radiogroup" aria-label={t("patients.chart.dentition")} className="inline-flex rounded-lg border border-border p-0.5">
              {(["adult", "child"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={dentition === d}
                  onClick={() => setDentition(d)}
                  className={cn(
                    "rounded-md px-3 py-1 text-sm",
                    dentition === d ? "bg-primary text-on-primary" : "text-muted hover:text-text",
                  )}
                >
                  {t(`patients.chart.${d}`)}
                </button>
              ))}
            </div>
          }
        />
        <CardBody className="flex flex-col gap-4">
          <p className="text-sm text-muted">{t("patients.chart.hint")}</p>
          <DentalChart dentition={dentition} states={states} planned={planned} selected={selected} onSelect={setSelected} />
          <ChartLegend />
        </CardBody>
      </Card>

      {recorded.length > 0 && (
        <Card>
          <CardHeader title={t("patients.chart.recorded", { count: recorded.length })} />
          <Table>
            <thead>
              <tr>
                <Th>{t("patients.plans.tooth")}</Th>
                <Th>{t("patients.chart.status")}</Th>
                <Th>{t("patients.chart.surfaces")}</Th>
                <Th>{t("patients.chart.notes")}</Th>
              </tr>
            </thead>
            <tbody>
              {recorded.map(([tooth, s]) => (
                <tr key={tooth} className="cursor-pointer hover:bg-primary-soft" onClick={() => setSelected(tooth)}>
                  <Td className="font-semibold">{tooth}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <StatusSwatch status={s.status} />
                      {t(`patients.toothStatus.${s.status}`)}
                    </span>
                  </Td>
                  <Td>{s.surfaces.join(", ")}</Td>
                  <Td className="max-w-64 truncate text-muted">{s.notes}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <ToothDialog
        key={selected ?? "none"}
        patientId={patient.id}
        tooth={selected}
        state={selected != null ? states.get(selected) : undefined}
        items={(items ?? []).filter((i) => i.tooth === selected)}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function ToothDialog({
  patientId,
  tooth,
  state,
  items,
  onClose,
}: {
  patientId: string;
  tooth: number | null;
  state: (ToothState & { id: string }) | undefined;
  items: PlanItem[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { user } = useAuth();
  const { can } = useCabinet();
  const readOnly = !can.clinicalWrite;
  const [status, setStatus] = useState<ToothStatus>(state?.status ?? "healthy");
  const [surfaces, setSurfaces] = useState<Surface[]>(SURFACES.filter((s) => state?.surfaces.includes(s)));
  const [notes, setNotes] = useState(state?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (tooth == null) return;
    setSaving(true);
    try {
      await mutate("tooth_records", {
        id: state?.id ?? (await toothRecordId(patientId, tooth)),
        cabinet_id: cabinetId,
        patient_id: patientId,
        tooth,
        status,
        surfaces,
        notes: notes.trim() || null,
        updated_by: user?.id ?? null,
      });
      toast(t("patients.chart.saved", { n: tooth }));
      onClose();
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={tooth != null}
      onClose={onClose}
      title={tooth != null ? t("patients.chart.tooth", { n: tooth }) : ""}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {readOnly ? t("common.close") : t("common.cancel")}
          </Button>
          {!readOnly && (
            <Button onClick={save} loading={saving}>
              {t("common.save")}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset disabled={readOnly}>
          <legend className="mb-2 text-sm font-medium">{t("patients.chart.status")}</legend>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {TOOTH_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                onClick={() => setStatus(s)}
                className={cn(
                  "flex min-h-10 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm",
                  status === s ? "border-primary bg-primary-soft font-medium text-primary ring-1 ring-primary" : "border-border hover:bg-primary-soft",
                )}
              >
                <StatusSwatch status={s} />
                {t(`patients.toothStatus.${s}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={readOnly}>
          <legend className="mb-2 text-sm font-medium">{t("patients.chart.surfaces")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {SURFACES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={surfaces.includes(s)}
                onClick={() => setSurfaces((l) => toggleSurface(l, s))}
                title={t(`patients.chart.surface.${s}`)}
                className={cn(
                  "flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-sm",
                  surfaces.includes(s) ? "border-primary bg-primary text-on-primary" : "border-border hover:bg-primary-soft",
                )}
              >
                <span className="font-semibold">{s}</span>
                <span className="text-xs opacity-80">{t(`patients.chart.surface.${s}`)}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <Field label={t("patients.chart.notes")}>
          {(p) => <Textarea {...p} rows={2} disabled={readOnly} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-medium">{t("patients.chart.plannedItems")}</p>
          {items.length === 0 ? (
            <p className="text-sm text-muted">{t("patients.chart.noPlannedItems")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{i.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-muted">{formatGNF(lineTotal(i), locale)}</span>
                    <Badge tone={i.status === "done" ? "success" : i.status === "cancelled" ? "neutral" : "info"}>
                      {t(`patients.plans.itemStatus.${i.status}`)}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
