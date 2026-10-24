"use client";

import { Suspense } from "react";
import { PageSpinner } from "@/components/ui/card";
import { PatientFile } from "@/features/patients/components/patient-file";

export default function PatientFilePage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <PatientFile />
    </Suspense>
  );
}
