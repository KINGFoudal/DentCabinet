"use client";

import { Suspense } from "react";
import { PageSpinner } from "@/components/ui/card";
import { SubscriptionPage } from "@/features/subscription/components/subscription-page";

export default function AbonnementPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <SubscriptionPage />
    </Suspense>
  );
}
