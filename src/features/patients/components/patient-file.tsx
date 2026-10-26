"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, ArrowLeft, Pencil, Phone } from "lucide-react";
import { softDelete, mutate } from "@/lib/sync/mutate";
import { supabase } from "@/lib/supabase/client";
import { ageFrom, formatPhone, fullName } from "@/lib/format";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { PageSpinner } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { PatientAppointments } from "@/features/agenda/components/patient-appointments";
import { PatientBilling } from "@/features/billing/components/patient-billing";
import { PatientWhatsApp } from "@/features/whatsapp/components/context-buttons";
import { usePatient, usePatientMedical } from "../lib/hooks";
import { Avatar } from "./avatar";
import { FinishConsultationButton } from "./consultation";
import { MedicalAlertsBanner } from "./medical-alerts";
import { PatientFormDialog } from "./patient-form-dialog";
import { SummaryTab } from "./tabs/summary-tab";
import { MedicalTab } from "./tabs/medical-tab";
import { ChartTab } from "./tabs/chart-tab";
import { NotesTab } from "./tabs/notes-tab";
import { PlansTab } from "./tabs/plans-tab";
import { PrescriptionsTab } from "./tabs/prescriptions-tab";
import { DocumentsTab } from "./tabs/documents-tab";

export type PatientTab =
  | "summary"
  | "medical"
  | "chart"
  | "notes"
  | "plans"
  | "prescriptions"
  | "documents"
  | "appointments"
  | "billing";

/** Fiche patient (lit ?id= et ?tab= ; à rendre sous <Suspense>). */
export function PatientFile() {
  const params = useSearchParams();
  const id = params.get("id");
  const tab = params.get("tab");
  return <PatientFileView key={id ?? "none"} id={id} initialTab={tab as PatientTab | null} />;
}

function PatientFileView({ id, initialTab }: { id: string | null; initialTab: PatientTab | null }) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const cabinetId = useCabinetId();
  const { can, roles } = useCabinet();
  const patient = usePatient(cabinetId, id);
  const medical = usePatientMedical(cabinetId, id ?? "", can.medical && !!id);
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const isAdmin = roles.includes("admin");
  const canDocuments = roles.some((r) => r === "admin" || r === "dentist" || r === "assistant");
  const tabs: { value: PatientTab; label: string; visible: boolean }[] = [
    { value: "summary", label: t("patients.tabs.summary"), visible: true },
    { value: "medical", label: t("patients.tabs.medical"), visible: can.medical },
    { value: "chart", label: t("patients.tabs.chart"), visible: can.clinical },
    { value: "notes", label: t("patients.tabs.notes"), visible: can.clinical },
    { value: "plans", label: t("patients.tabs.plans"), visible: can.clinical },
    { value: "prescriptions", label: t("patients.tabs.prescriptions"), visible: can.clinical },
    { value: "documents", label: t("patients.tabs.documents"), visible: canDocuments },
    { value: "appointments", label: t("patients.tabs.appointments"), visible: true },
    { value: "billing", label: t("patients.tabs.billing"), visible: can.billingRead },
  ];
  const visibleTabs = tabs.filter((x) => x.visible);
  const [tabState, setTab] = useState<PatientTab>(initialTab ?? "summary");
  const tab = visibleTabs.some((x) => x.value === tabState) ? tabState : "summary";

  // Traçabilité : chaque ouverture de dossier est journalisée (en ligne seulement).
  useEffect(() => {
    if (!id || !navigator.onLine) return;
    supabase()
      .rpc("log_patient_view", { p_patient: id })
      .then(
        () => undefined,
        () => undefined,
      );
  }, [id]);

  function changeTab(v: PatientTab) {
    setTab(v);
    router.replace(`/app/patients/fiche?id=${id}&tab=${v}`, { scroll: false });
  }

  if (patient === undefined) return <PageSpinner />;
  if (!patient) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-muted">{t("patients.file.notFound")}</p>
        <Link href="/app/patients" className={buttonClass("secondary")}>
          {t("patients.file.back")}
        </Link>
      </div>
    );
  }

  const age = ageFrom(patient.birth_date);
  const archived = !!patient.deleted_at;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/app/patients" className="no-print inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-primary">
        <ArrowLeft className="size-4" />
        {t("patients.file.back")}
      </Link>

      {archived && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          {t("patients.archive.banner")}
          {isAdmin && can.patientsWrite && (
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await mutate("patients", { id: patient.id, deleted_at: null });
                toast(t("patients.archive.restored"));
              }}
            >
              {t("patients.archive.restore")}
            </Button>
          )}
        </div>
      )}

      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar first={patient.first_name} last={patient.last_name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold sm:text-2xl">{fullName(patient)}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              {patient.file_number ? (
                <span className="whitespace-nowrap font-medium text-text">{patient.file_number}</span>
              ) : (
                <Badge tone="warning">{t("patients.provisional")}</Badge>
              )}
              {age != null && <span>{t("patients.years", { count: age })}</span>}
              {patient.sex && <span>{t(`patients.sex.${patient.sex}`)}</span>}
              {patient.phone && (
                <a href={`tel:${patient.phone}`} className="inline-flex items-center gap-1 whitespace-nowrap text-primary">
                  <Phone className="size-3.5" />
                  {formatPhone(patient.phone)}
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          {!archived && <FinishConsultationButton patientId={patient.id} />}
          {!archived && <PatientWhatsApp patient={patient} />}
          {can.patientsWrite && !archived && (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
              {t("patients.file.editAdmin")}
            </Button>
          )}
          {isAdmin && can.patientsWrite && !archived && (
            <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmArchive(true)}>
              <Archive className="size-4" />
              {t("patients.archive.action")}
            </Button>
          )}
        </div>
      </header>

      {can.medical && medical && <MedicalAlertsBanner alerts={medical.alerts} allergies={medical.allergies} />}

      <div className="no-print">
        <Tabs value={tab} onChange={changeTab} items={visibleTabs.map(({ value, label }) => ({ value, label }))} />
      </div>

      <div role="tabpanel" aria-label={visibleTabs.find((x) => x.value === tab)?.label}>
        {tab === "summary" && <SummaryTab patient={patient} medical={medical} />}
        {tab === "medical" && <MedicalTab patientId={patient.id} medical={medical ?? null} />}
        {tab === "chart" && <ChartTab patient={patient} />}
        {tab === "notes" && <NotesTab patientId={patient.id} />}
        {tab === "plans" && <PlansTab patientId={patient.id} />}
        {tab === "prescriptions" && <PrescriptionsTab patientId={patient.id} />}
        {tab === "documents" && <DocumentsTab patientId={patient.id} />}
        {tab === "appointments" && <PatientAppointments patientId={patient.id} />}
        {tab === "billing" && <PatientBilling patientId={patient.id} />}
      </div>

      <PatientFormDialog open={editing} onClose={() => setEditing(false)} patient={patient} />
      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={async () => {
          await softDelete("patients", patient.id);
          toast(t("patients.archive.done"));
          router.push("/app/patients");
        }}
        title={t("patients.archive.title")}
        message={t("patients.archive.message")}
        confirmLabel={t("patients.archive.action")}
        cancelLabel={t("common.cancel")}
        danger
      />
    </div>
  );
}
