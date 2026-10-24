"use client";

import { AlertTriangle } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { alertLabel, sortAlerts } from "../lib/clinical";

/** Bandeau rouge des alertes médicales et allergies, affiché en haut de la fiche. */
export function MedicalAlertsBanner({ alerts, allergies }: { alerts: readonly string[]; allergies: string | null }) {
  const t = useT();
  const list = sortAlerts(alerts);
  if (!list.length && !allergies?.trim()) return null;
  return (
    <div role="alert" className="flex gap-3 rounded-xl border-2 border-danger bg-danger-soft px-3 py-2.5 text-danger">
      <AlertTriangle className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold uppercase tracking-wide">{t("patients.summary.alertsTitle")}</p>
        {list.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {list.map((a) => (
              <li key={a} className="rounded-full bg-danger px-2.5 py-0.5 text-sm font-medium text-white">
                {alertLabel(t, a)}
              </li>
            ))}
          </ul>
        )}
        {allergies?.trim() && (
          <p className="mt-1.5 text-sm">
            <span className="font-semibold">{t("patients.summary.allergies")} : </span>
            {allergies}
          </p>
        )}
      </div>
    </div>
  );
}
