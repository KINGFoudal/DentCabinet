"use client";

import { useCallback } from "react";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";

/**
 * Pour une écriture locale lancée sans `await` (gestionnaire d'événement) :
 * `const report = useReportWrite(); onClick={() => report(softDelete("acts", id))}`.
 * Un échec (IndexedDB plein ou indisponible, base fermée...) affiche « Une erreur est
 * survenue » au lieu d'être perdu en silence.
 */
export function useReportWrite() {
  const toast = useToast();
  const t = useT();
  return useCallback(
    (work: Promise<unknown> | undefined | null | false) => {
      if (!work) return;
      work.catch((e: unknown) => {
        console.error("[local write]", e);
        toast(t("common.error"), "error");
      });
    },
    [toast, t],
  );
}
