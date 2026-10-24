"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Row } from "@/lib/local/db";
import { mutate } from "@/lib/sync/mutate";
import { formatDateTime } from "@/lib/format";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { addAlert, alertLabel, isKnownAlert, MEDICAL_ALERTS } from "../../lib/clinical";

export function MedicalTab({ patientId, medical }: { patientId: string; medical: Row<"patient_medical"> | null }) {
  // Le formulaire est réinitialisé quand la version enregistrée change (synchronisation, autre appareil).
  return <MedicalForm key={medical?.updated_at ?? "new"} patientId={patientId} medical={medical} />;
}

function MedicalForm({ patientId, medical }: { patientId: string; medical: Row<"patient_medical"> | null }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const cabinetId = useCabinetId();
  const { can, cabinet } = useCabinet();
  const readOnly = !can.medicalWrite;
  const [alerts, setAlerts] = useState<string[]>(medical?.alerts ?? []);
  const [other, setOther] = useState("");
  const [allergies, setAllergies] = useState(medical?.allergies ?? "");
  const [history, setHistory] = useState(medical?.medical_history ?? "");
  const [treatments, setTreatments] = useState(medical?.current_treatments ?? "");
  const [saving, setSaving] = useState(false);

  const toggle = (code: string) => setAlerts((l) => (l.includes(code) ? l.filter((x) => x !== code) : [...l, code]));
  const freeAlerts = alerts.filter((a) => !isKnownAlert(a));
  const dirty =
    JSON.stringify([...alerts].sort()) !== JSON.stringify([...(medical?.alerts ?? [])].sort()) ||
    allergies !== (medical?.allergies ?? "") ||
    history !== (medical?.medical_history ?? "") ||
    treatments !== (medical?.current_treatments ?? "") ||
    !!other.trim();

  async function save() {
    setSaving(true);
    try {
      const finalAlerts = addAlert(alerts, other);
      await mutate("patient_medical", {
        patient_id: patientId,
        cabinet_id: cabinetId,
        alerts: finalAlerts,
        allergies: allergies.trim() || null,
        medical_history: history.trim() || null,
        current_treatments: treatments.trim() || null,
      });
      setOther("");
      toast(t("patients.medical.saved"));
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={t("patients.medical.title")}
        actions={
          medical && (
            <span className="text-xs text-muted">
              {t("patients.medical.lastUpdate", { date: formatDateTime(medical.updated_at, locale, cabinet?.timezone) })}
            </span>
          )
        }
      />
      <CardBody className="flex flex-col gap-5">
        <fieldset disabled={readOnly}>
          <legend className="mb-2 text-sm font-medium">{t("patients.medical.alerts")}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {MEDICAL_ALERTS.map((code) => {
              const on = alerts.includes(code);
              return (
                <label
                  key={code}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                    on ? "border-danger bg-danger-soft font-medium text-danger" : "border-border hover:bg-primary-soft",
                  )}
                >
                  <input type="checkbox" className="size-4 accent-danger" checked={on} onChange={() => toggle(code)} />
                  {t(`patients.alerts.${code}`)}
                </label>
              );
            })}
          </div>
          {freeAlerts.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {freeAlerts.map((a) => (
                <li key={a} className="inline-flex items-center gap-1 rounded-full border border-danger bg-danger-soft py-0.5 pl-3 pr-1 text-sm text-danger">
                  {alertLabel(t, a)}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => toggle(a)}
                      className="rounded-full p-1 hover:bg-danger hover:text-white"
                      aria-label={t("patients.medical.removeAlert", { name: a })}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!readOnly && (
            <div className="mt-3 flex items-end gap-2">
              <Field label={t("patients.medical.otherAlert")} className="flex-1">
                {(p) => (
                  <Input
                    {...p}
                    value={other}
                    placeholder={t("patients.medical.otherAlertPlaceholder")}
                    onChange={(e) => setOther(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setAlerts((l) => addAlert(l, other));
                        setOther("");
                      }
                    }}
                  />
                )}
              </Field>
              <Button
                variant="secondary"
                disabled={!other.trim()}
                onClick={() => {
                  setAlerts((l) => addAlert(l, other));
                  setOther("");
                }}
              >
                <Plus className="size-4" />
                {t("patients.medical.addAlert")}
              </Button>
            </div>
          )}
        </fieldset>

        <fieldset disabled={readOnly} className="grid gap-4 lg:grid-cols-3">
          <Field label={t("patients.medical.allergies")}>
            {(p) => (
              <Textarea {...p} value={allergies} placeholder={t("patients.medical.allergiesPlaceholder")} onChange={(e) => setAllergies(e.target.value)} />
            )}
          </Field>
          <Field label={t("patients.medical.history")}>
            {(p) => <Textarea {...p} value={history} onChange={(e) => setHistory(e.target.value)} />}
          </Field>
          <Field label={t("patients.medical.treatments")}>
            {(p) => <Textarea {...p} value={treatments} onChange={(e) => setTreatments(e.target.value)} />}
          </Field>
        </fieldset>

        {!readOnly && (
          <div className="flex justify-end">
            <Button onClick={save} loading={saving} disabled={!dirty}>
              {t("common.save")}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
