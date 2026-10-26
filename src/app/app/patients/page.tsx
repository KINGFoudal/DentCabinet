"use client";

import { Suspense } from "react";
import { PageSpinner } from "@/components/ui/card";
import { PatientList } from "@/features/patients/components/patient-list";

export default function PatientsPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <PatientList />
    </Suspense>
  );
}
