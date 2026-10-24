"use client";

import type { ReactNode } from "react";
import type { Row } from "@/lib/local/db";
import { ageFrom, formatDate, formatPhone } from "@/lib/format";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { alertLabel, sortAlerts } from "../../lib/clinical";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-sm text-muted sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

export function SummaryTab({ patient, medical }: { patient: Row<"patients">; medical: Row<"patient_medical"> | null | undefined }) {
  const { t, locale } = useI18n();
  const { can, cabinet } = useCabinet();
  const tz = cabinet?.timezone ?? "Africa/Conakry";
  const age = ageFrom(patient.birth_date);
  const none = <span className="text-muted">{t("patients.summary.notFilled")}</span>;
  const alerts = sortAlerts(medical?.alerts ?? []);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("patients.summary.identity")} />
        <CardBody>
          <dl className="flex flex-col gap-2.5">
            <Item label={t("patients.fields.fileNumber")}>
              {patient.file_number ?? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Badge tone="warning">{t("patients.provisional")}</Badge>
                  <span className="text-xs text-muted">{t("patients.provisionalHint")}</span>
                </span>
              )}
            </Item>
            <Item label={t("patients.fields.sex")}>{patient.sex ? t(`patients.sex.${patient.sex}`) : none}</Item>
            <Item label={t("patients.fields.birthDate")}>
              {patient.birth_date ? (
                <>
                  {formatDate(patient.birth_date + "T12:00:00Z", locale, tz)}
                  {age != null && <span className="text-muted"> ({t("patients.years", { count: age })})</span>}
                </>
              ) : (
                none
              )}
            </Item>
            <Item label={t("patients.fields.profession")}>{patient.profession || none}</Item>
            <Item label={t("patients.fields.createdAt")}>{formatDate(patient.created_at, locale, tz)}</Item>
          </dl>
        </CardBody>
      </Card>

      {can.medical && (
        <Card>
          <CardHeader title={t("patients.summary.alertsTitle")} />
          <CardBody className="flex flex-col gap-3">
            {alerts.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {alerts.map((a) => (
                  <li key={a}>
                    <Badge tone="danger" className="text-sm">
                      {alertLabel(t, a)}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t("common.none")}</p>
            )}
            <div>
              <p className="text-sm font-medium">{t("patients.summary.allergies")}</p>
              <p className={medical?.allergies ? "text-sm font-medium text-danger" : "text-sm text-muted"}>
                {medical?.allergies || t("patients.summary.noAllergies")}
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t("patients.summary.contact")} />
        <CardBody>
          <dl className="flex flex-col gap-2.5">
            <Item label={t("patients.fields.phone")}>
              {patient.phone ? (
                <a href={`tel:${patient.phone}`} className="text-primary underline">
                  {formatPhone(patient.phone)}
                </a>
              ) : (
                none
              )}
              {patient.phone && (
                <div className="text-xs text-muted">
                  {t(patient.whatsapp_opt_in ? "patients.summary.whatsappYes" : "patients.summary.whatsappNo")}
                </div>
              )}
            </Item>
            <Item label={t("patients.fields.email")}>{patient.email || none}</Item>
            <Item label={t("patients.fields.address")}>{patient.address || none}</Item>
            <Item label={t("patients.fields.city")}>{patient.city || none}</Item>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("patients.summary.emergency")} />
        <CardBody>
          <dl className="flex flex-col gap-2.5">
            <Item label={t("patients.fields.emergencyName")}>{patient.emergency_contact_name || none}</Item>
            <Item label={t("patients.fields.emergencyPhone")}>
              {patient.emergency_contact_phone ? (
                <a href={`tel:${patient.emergency_contact_phone}`} className="text-primary underline">
                  {formatPhone(patient.emergency_contact_phone)}
                </a>
              ) : (
                none
              )}
            </Item>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("patients.summary.insurance")} />
        <CardBody>
          <dl className="flex flex-col gap-2.5">
            <Item label={t("patients.fields.insuranceName")}>{patient.insurance_name || none}</Item>
            <Item label={t("patients.fields.insuranceNumber")}>{patient.insurance_number || none}</Item>
          </dl>
        </CardBody>
      </Card>

      {patient.admin_notes && (
        <Card>
          <CardHeader title={t("patients.fields.adminNotes")} />
          <CardBody>
            <p className="whitespace-pre-wrap text-sm">{patient.admin_notes}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
