"use client";

import { Suspense } from "react";
import { PageSpinner } from "@/components/ui/card";
import { AgendaView } from "@/features/agenda/components/agenda-view";

export default function AgendaPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <AgendaView />
    </Suspense>
  );
}
