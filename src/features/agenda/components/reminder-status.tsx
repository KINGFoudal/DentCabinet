"use client";

import { useEffect, useState } from "react";
import { MessageCircle, Mail } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { formatDateTime } from "@/lib/format";
import { Badge, type Tone } from "@/components/ui/badge";
import type { Tables } from "@/lib/database.types";

type Log = Pick<Tables<"notification_log">, "id" | "kind" | "channel" | "status" | "sent_at" | "created_at" | "error" | "provider_message_id">;

export function logTone(status: string): Tone {
  if (status === "failed") return "danger";
  if (status === "queued") return "warning";
  if (status === "read" || status === "delivered") return "success";
  return "primary";
}

export const isSandboxLog = (l: { provider_message_id: string | null }) => !!l.provider_message_id?.startsWith("sandbox-");

/** État des rappels d'un RDV (requête en ligne ; silencieux hors ligne ou sans droit). */
export function ReminderStatus({ appointmentId }: { appointmentId: string }) {
  const { t, locale } = useI18n();
  const { cabinet } = useCabinet();
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      queueMicrotask(() => !cancelled && setOffline(true));
      return () => {
        cancelled = true;
      };
    }
    supabase()
      .from("notification_log")
      .select("id, kind, channel, status, sent_at, created_at, error, provider_message_id")
      .eq("appointment_id", appointmentId)
      .order("created_at", { ascending: true })
      .then(
        ({ data, error }) => {
          if (cancelled) return;
          if (error) setOffline(true);
          else setLogs(data ?? []);
        },
        () => !cancelled && setOffline(true),
      );
    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  if (offline) return <p className="text-xs text-muted">{t("agenda.reminders.offline")}</p>;
  if (!logs) return null;
  if (!logs.length) return <p className="text-xs text-muted">{t("agenda.reminders.none")}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {logs.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
          {l.channel === "email" ? <Mail className="size-4 text-muted" /> : <MessageCircle className="size-4 text-muted" />}
          <span>{t(`agenda.templates.kind.${l.kind}`)}</span>
          <Badge tone={logTone(l.status)}>{t(`agenda.log.status.${l.status}`)}</Badge>
          {isSandboxLog(l) && <Badge tone="neutral">{t("agenda.reminders.sandbox")}</Badge>}
          <span className="text-xs text-muted">{formatDateTime(l.sent_at ?? l.created_at, locale, cabinet?.timezone)}</span>
          {l.error && l.status === "failed" && <span className="w-full text-xs text-danger">{l.error}</span>}
        </li>
      ))}
    </ul>
  );
}
