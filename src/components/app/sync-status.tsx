"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CloudOff, RefreshCw, AlertTriangle, Check } from "lucide-react";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { localDb } from "@/lib/local/db";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { formatTime } from "@/lib/format";

/** Message lisible pour un refus du serveur (code Postgres). */
export function syncErrorMessage(code: string | undefined, locale: "fr" | "en") {
  const fr: Record<string, string> = {
    "23P01": "Créneau déjà occupé pour ce praticien ou ce fauteuil.",
    "42501": "Action non autorisée pour votre rôle, ou abonnement expiré.",
    "23505": "Cet élément existe déjà.",
    "23503": "Élément lié introuvable (il a peut-être été refusé lui aussi).",
    "23514": "Valeur invalide.",
  };
  const en: Record<string, string> = {
    "23P01": "Time slot already taken for this dentist or chair.",
    "42501": "Not allowed for your role, or subscription expired.",
    "23505": "This item already exists.",
    "23503": "Linked item not found (it may have been rejected too).",
    "23514": "Invalid value.",
  };
  return (locale === "fr" ? fr : en)[code ?? ""] ?? null;
}

export function SyncStatus() {
  const { sync, engine } = useCabinet();
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const failed = useLiveQuery(() => localDb().outbox.where("status").equals("failed").toArray(), []) ?? [];

  let icon = <Check className="size-4" />;
  let label = t("sync.upToDate");
  let tone = "text-success";
  if (!sync.online) {
    icon = <CloudOff className="size-4" />;
    label = sync.pending ? t("sync.pending", { count: sync.pending }) : t("sync.offline");
    tone = "text-warning";
  } else if (sync.failed) {
    icon = <AlertTriangle className="size-4" />;
    label = t("sync.failed", { count: sync.failed });
    tone = "text-danger";
  } else if (sync.syncing || sync.pending) {
    icon = <RefreshCw className={cn("size-4", sync.syncing && "animate-spin")} />;
    label = sync.pending ? t("sync.pending", { count: sync.pending }) : t("sync.syncing");
    tone = "text-info";
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (sync.failed ? setOpen(true) : engine?.sync())}
        title={sync.lastSyncAt ? t("sync.lastSync", { time: formatTime(sync.lastSyncAt, locale) }) : undefined}
        className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium hover:bg-primary-soft", tone)}
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("sync.failedTitle")} size="lg">
        <ul className="flex flex-col gap-3">
          {failed.map((f) => (
            <li key={f.seq} className="rounded-lg border border-border p-3 text-sm">
              <div className="font-medium">{f.table}</div>
              <div className="text-danger">{syncErrorMessage(f.errorCode, locale) ?? f.error}</div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => engine?.retry(f.seq!)}>
                  {t("sync.retry")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => engine?.discard(f.seq!)}>
                  {t("sync.discard")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
