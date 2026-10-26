"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MessageCircle, RefreshCw, RotateCcw } from "lucide-react";
import { localDb, type Row } from "@/lib/local/db";
import { mutate } from "@/lib/sync/mutate";
import { supabase } from "@/lib/supabase/client";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { formatDateTime, formatPhone, fullName } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { Tables } from "@/lib/database.types";
import {
  appointmentVars,
  customTemplate,
  defaultText,
  invoiceVars,
  langOf,
  NOTIFY_DEFAULTS,
  PATIENT_MESSAGE_KINDS,
  renderPatientMessage,
  unknownPatientVariables,
  VARIABLES_BY_KIND,
  type Lang,
  type NotifySetting,
  type PatientMessageKind,
  type PatientMessageVars,
} from "../../../../supabase/functions/_shared/patient-messages";
import { useWhatsAppTemplates } from "./whatsapp-composer";

type Template = Row<"message_templates">;
const LANGS: Lang[] = ["fr", "en"];
const SETTINGS = Object.keys(NOTIFY_DEFAULTS) as NotifySetting[];

/** Onglet « WhatsApp patients » des paramètres de messages. */
export function WhatsAppSettings() {
  return (
    <div className="flex flex-col gap-4">
      <AutoSettings />
      <PatientTemplates />
      <AutoLog />
    </div>
  );
}

function AutoSettings() {
  const { t } = useI18n();
  const { cabinet, can } = useCabinet();
  const toast = useToast();
  if (!cabinet) return null;
  const value = (k: NotifySetting) => (cabinet as Partial<Record<NotifySetting, boolean>>)[k] ?? NOTIFY_DEFAULTS[k];
  async function toggle(k: NotifySetting, v: boolean) {
    await mutate("cabinets", { id: cabinet!.id, [k]: v } as Partial<Row<"cabinets">>);
    toast(t("common.saved"));
  }
  return (
    <Card>
      <CardHeader title={t("whatsapp.settings.autoTitle")} />
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-muted">{t("whatsapp.settings.autoHint")}</p>
        {SETTINGS.map((k) => (
          <Checkbox
            key={k}
            label={t(`whatsapp.settings.autoOptions.${k}`)}
            checked={value(k)}
            disabled={!can.settingsWrite}
            onChange={(e) => void toggle(k, e.target.checked)}
          />
        ))}
        <p className="text-xs text-muted">{t("whatsapp.settings.autoNote")}</p>
      </CardBody>
    </Card>
  );
}

function useSampleVars(lang: Lang): Record<PatientMessageKind, PatientMessageVars> {
  const { cabinet } = useCabinet();
  // Exemple : demain à la même heure (fixé à l'affichage).
  const [tomorrow] = useState(() => new Date(Date.now() + 24 * 3600 * 1000).toISOString());
  return useMemo(() => {
    const c = { name: cabinet?.name ?? "Cabinet", phone: cabinet?.phone ?? "+224620000000", address: cabinet?.address, city: cabinet?.city, timezone: cabinet?.timezone, locale: lang };
    const p = { first_name: "Mariama", last_name: "Diallo" };
    const startsAt = tomorrow;
    const appt = appointmentVars(c, p, { starts_at: startsAt }, "Dr Camara");
    const inv = { number: "F-2026-00012", total: 450000, paid: 150000 };
    const out = {} as Record<PatientMessageKind, PatientMessageVars>;
    for (const k of PATIENT_MESSAGE_KINDS) {
      out[k] =
        k === "payment_received"
          ? invoiceVars(c, p, inv, { amountPaid: 150000 })
          : k === "installment_due"
            ? invoiceVars(c, p, inv, { installment: { amount: 150000, due_date: startsAt.slice(0, 10) } })
            : VARIABLES_BY_KIND[k].includes("invoice_number")
              ? invoiceVars(c, p, inv)
              : appt;
    }
    return out;
  }, [cabinet, lang, tomorrow]);
}

function PatientTemplates() {
  const { t } = useI18n();
  const cabinetId = useCabinetId();
  const { cabinet, can } = useCabinet();
  const [lang, setLang] = useState<Lang>(langOf(cabinet?.locale));
  const templates = useWhatsAppTemplates(cabinetId);
  const vars = useSampleVars(lang);
  const [editing, setEditing] = useState<PatientMessageKind | null>(null);
  if (!templates) return null;
  return (
    <Card>
      <CardHeader
        title={t("whatsapp.settings.templatesTitle")}
        actions={
          <Select aria-label={t("whatsapp.settings.language")} value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="h-9 w-28">
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {t(`agenda.templates.locale.${l}`)}
              </option>
            ))}
          </Select>
        }
      />
      <p className="border-b border-border px-4 py-3 text-sm text-muted">{t("whatsapp.settings.templatesHint")}</p>
      <ul className="divide-y divide-border">
        {PATIENT_MESSAGE_KINDS.map((kind) => {
          const custom = customTemplate(templates, cabinetId, kind, lang);
          const isCustom = !!custom && custom.body.trim() !== defaultText(kind, lang);
          const body = custom?.body ?? defaultText(kind, lang);
          return (
            <li key={kind} className="flex items-start gap-3 px-4 py-3">
              <MessageCircle className="mt-0.5 size-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {t(`whatsapp.kind.${kind}`)}
                  <Badge tone={isCustom ? "primary" : "neutral"}>{isCustom ? t("whatsapp.settings.custom") : t("whatsapp.settings.default")}</Badge>
                  {custom && !custom.enabled && <Badge tone="warning">{t("whatsapp.settings.disabledAuto")}</Badge>}
                </div>
                <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm text-muted">{renderPatientMessage(body, vars[kind])}</p>
              </div>
              {can.settingsWrite && (
                <Button size="sm" variant="secondary" onClick={() => setEditing(kind)}>
                  {t("common.edit")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={t("whatsapp.settings.edit")} size="lg">
        {editing && <TemplateEditor key={`${editing}-${lang}`} kind={editing} lang={lang} vars={vars[editing]} onDone={() => setEditing(null)} />}
      </Dialog>
    </Card>
  );
}

function TemplateEditor({ kind, lang, vars, onDone }: { kind: PatientMessageKind; lang: Lang; vars: PatientMessageVars; onDone: () => void }) {
  const { t } = useI18n();
  const cabinetId = useCabinetId();
  const toast = useToast();
  // Toutes les lignes, y compris supprimées : la clé (cabinet, type, canal, langue) est unique.
  const rows = useLiveQuery(
    async () => (await localDb().message_templates.where("cabinet_id").equals(cabinetId).toArray()).filter((x) => x.kind === kind && x.channel === "whatsapp" && x.locale === lang),
    [cabinetId, kind, lang],
  );
  const live = rows?.find((r) => !r.deleted_at);
  const custom = live && customTemplate([live], cabinetId, kind, lang);
  const [body, setBody] = useState<string | null>(null);
  const text = body ?? (custom ? custom.body.replace(/\\n/g, "\n") : defaultText(kind, lang));
  const sel = useRef<[number, number] | null>(null);
  const unknown = unknownPatientVariables(text, kind);

  async function save(next: string) {
    const existing = live ?? rows?.[0];
    await mutate("message_templates", {
      id: existing?.id,
      cabinet_id: cabinetId,
      kind: kind as Template["kind"],
      channel: "whatsapp",
      locale: lang,
      subject: null,
      body: next.trim(),
      enabled: existing?.enabled ?? true,
      deleted_at: null,
    });
  }

  function insert(v: string) {
    const token = `{{${v}}}`;
    const [s, e] = sel.current ?? [text.length, text.length];
    setBody(text.slice(0, s) + token + text.slice(e));
    sel.current = [s + token.length, s + token.length];
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium">
        {t(`whatsapp.kind.${kind}`)} · {t(`agenda.templates.locale.${lang}`)}
      </p>
      <Field label={t("whatsapp.settings.body")} error={text.trim() ? undefined : t("whatsapp.emptyText")}>
        {(p) => (
          <Textarea
            {...p}
            value={text}
            onChange={(e) => setBody(e.target.value)}
            onSelect={(e) => (sel.current = [e.currentTarget.selectionStart, e.currentTarget.selectionEnd])}
            className="min-h-44"
          />
        )}
      </Field>
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted">{t("whatsapp.settings.variables")}</div>
        <div className="flex flex-wrap gap-1.5">
          {VARIABLES_BY_KIND[kind].map((v) => (
            <button key={v} type="button" onClick={() => insert(v)} className="rounded-full border border-border px-2 py-0.5 font-mono text-xs hover:border-primary hover:text-primary">
              {`{{${v}}}`}
            </button>
          ))}
        </div>
        {unknown.length > 0 && <p className="mt-2 text-xs text-danger">{t("whatsapp.settings.unknownVariables", { list: unknown.join(", ") })}</p>}
      </div>
      <div>
        <div className="mb-1.5 text-xs font-medium uppercase text-muted">{t("agenda.templates.preview")}</div>
        <p className="whitespace-pre-line rounded-lg border border-border bg-primary-soft p-3 text-sm">{renderPatientMessage(text, vars)}</p>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-between">
        <Button
          variant="ghost"
          onClick={async () => {
            if (live) await save(defaultText(kind, lang));
            toast(t("whatsapp.settings.resetDone"));
            onDone();
          }}
        >
          <RotateCcw className="size-4" />
          {t("whatsapp.settings.reset")}
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="secondary" onClick={onDone}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!text.trim()}
            onClick={async () => {
              await save(text);
              toast(t("common.saved"));
              onDone();
            }}
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

type QueueRow = Tables<"patient_notifications">;

function statusTone(s: string) {
  if (s === "failed") return "danger" as const;
  if (s === "pending" || s === "sending") return "warning" as const;
  if (s === "skipped") return "neutral" as const;
  return "success" as const;
}

function AutoLog() {
  const { t, locale } = useI18n();
  const cabinetId = useCabinetId();
  const { cabinet } = useCabinet();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "offline" | "error">("loading");

  const load = useCallback(async () => {
    if (!navigator.onLine) return setState("offline");
    setState("loading");
    const { data, error } = await supabase()
      .from("patient_notifications")
      .select("*")
      .eq("cabinet_id", cabinetId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return setState(/fetch/i.test(error.message) ? "offline" : "error");
    setRows(data);
    setState("ok");
  }, [cabinetId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement en ligne à l'affichage
    void load();
  }, [load]);

  const patients = useLiveQuery(async () => {
    const ids = [...new Set((rows ?? []).map((r) => r.patient_id))];
    return new Map((await localDb().patients.bulkGet(ids)).filter((p) => !!p).map((p) => [p!.id, fullName(p)]));
  }, [rows]);

  return (
    <Card>
      <CardHeader
        title={t("whatsapp.settings.logTitle")}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void load()} loading={state === "loading"}>
            <RefreshCw className="size-4" />
            {t("agenda.log.refresh")}
          </Button>
        }
      />
      {state === "offline" && <p className="p-4 text-sm text-muted">{t("whatsapp.settings.logOffline")}</p>}
      {state === "error" && <p className="p-4 text-sm text-danger">{t("whatsapp.settings.logError")}</p>}
      {state === "ok" && rows?.length === 0 && <EmptyState icon={<MessageCircle />} title={t("whatsapp.settings.logEmpty")} />}
      {state !== "offline" && !!rows?.length && (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{patients?.get(r.patient_id) ?? "—"}</span>
                <Badge tone={statusTone(r.status)}>{t(`whatsapp.settings.status.${r.status}`)}</Badge>
              </div>
              <div className="text-xs text-muted">
                {t(`whatsapp.settings.event.${r.event}`)} · {r.recipient ? formatPhone(r.recipient) : ""} · {formatDateTime(r.sent_at ?? r.created_at, locale, cabinet?.timezone)}
              </div>
              {r.error && r.status !== "sent" && <span className="text-xs text-muted">{r.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
