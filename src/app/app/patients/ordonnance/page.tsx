"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageSpinner } from "@/components/ui/card";
import { PrescriptionPrint } from "@/features/patients/components/prescription-print";

function PrescriptionFromQuery() {
  const id = useSearchParams().get("id");
  return <PrescriptionPrint id={id} />;
}

export default function PrescriptionPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <PrescriptionFromQuery />
    </Suspense>
  );
}
