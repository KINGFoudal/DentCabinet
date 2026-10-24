import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSpinner } from "@/components/ui/card";
import { PrescriptionPrint } from "@/features/portal/components/prescription-print";

export const metadata: Metadata = { title: "Ordonnance", robots: { index: false } };

export default function PrescriptionPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <PrescriptionPrint />
    </Suspense>
  );
}
