"use client";

import { CheckCircle2 } from "lucide-react";
import { localDb } from "@/lib/local/db";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { waPhone } from "../lib/wa-link";
import { AppointmentWhatsApp } from "./context-buttons";

/** Le patient de ce RDV a-t-il un numéro WhatsApp utilisable ? */
export async function appointmentHasWhatsApp(patientId: string | null | undefined) {
  if (!patientId) return false;
  const p = await localDb().patients.get(patientId);
  return !!p && !p.deleted_at && !!waPhone(p.phone);
}

/** Écran affiché juste après la création d'un RDV : « Confirmer au patient par WhatsApp ». */
export function AppointmentCreated({ appointmentId, onDone }: { appointmentId: string; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center" data-testid="appointment-created">
      <CheckCircle2 className="size-10 text-success" />
      <div>
        <p className="text-lg font-semibold">{t("whatsapp.created")}</p>
        <p className="mt-1 text-sm text-muted">{t("whatsapp.createdHint")}</p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <AppointmentWhatsApp
          appointmentId={appointmentId}
          initial="booking_confirmation"
          label={t("whatsapp.confirmAppointment")}
          variant="primary"
          size="md"
          className="w-full sm:w-auto"
        />
        <Button variant="secondary" onClick={onDone} className="w-full sm:w-auto">
          {t("whatsapp.close")}
        </Button>
      </div>
    </div>
  );
}
