"use client";

import { Suspense } from "react";
import { PageSpinner } from "@/components/ui/card";
import { ConsultationScreen } from "@/features/patients/components/consultation";

export default function ConsultationPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <ConsultationScreen />
    </Suspense>
  );
}
