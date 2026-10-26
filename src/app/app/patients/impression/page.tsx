"use client";

import { Suspense } from "react";
import { PageSpinner } from "@/components/ui/card";
import { ConsultationPrint } from "@/features/patients/components/consultation-print";

export default function ConsultationPrintPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <ConsultationPrint />
    </Suspense>
  );
}
