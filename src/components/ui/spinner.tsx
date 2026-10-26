"use client";

import { useT } from "@/components/i18n-provider";
import { cn } from "./cn";

export function Spinner({ className }: { className?: string }) {
  const t = useT();
  return (
    <span
      role="status"
      aria-label={t("common.loading")}
      className={cn("inline-block size-5 animate-spin rounded-full border-2 border-primary border-r-transparent", className)}
    />
  );
}
