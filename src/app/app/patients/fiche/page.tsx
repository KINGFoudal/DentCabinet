"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { PageSpinner } from "@/components/ui/card";
import { useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { PatientFile } from "@/features/patients/components/patient-file";
import { rememberPatient } from "@/features/patients/lib/recent";

/** Mémorise la fiche ouverte dans « patients récents ». */
function RememberPatient() {
  const id = useSearchParams().get("id");
  const cabinetId = useCabinetId();
  useEffect(() => {
    if (id) rememberPatient(cabinetId, id);
  }, [cabinetId, id]);
  return null;
}

export default function PatientFilePage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <RememberPatient />
      <PatientFile />
    </Suspense>
  );
}
