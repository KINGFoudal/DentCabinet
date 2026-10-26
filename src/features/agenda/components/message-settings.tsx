"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Mail, MessageCircle, Plus, RefreshCw } from "lucide-react";
import { localDb, type Row } from "@/lib/local/db";
import { mutate } from "@/lib/sync/mutate";
import { supabase } from "@/lib/supabase/client";
import { useCabinet, useCabinetId } from "@/lib/cabinet/cabinet-provider";
import { useI18n } from "@/components/i18n-provider";
import { formatDateTime, formatPhone, fullName } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { RequirePermission } from "@/components/app/app-gate";
import type { Tables } from "@/lib/database.types";
import {
  renderTemplate,
  TEMPLATE_VARIABLES,
  unknownVariables,
  whatsappParam,
  type TemplateVars,
} from "../../../../supabase/functions/_shared/reminders";
import { isSandboxLog, logTone } from "./reminder-status";
import { WhatsAppSettings } from "@/features/whatsapp/components/whatsapp-settings";

type Template = Row<"message_templates">;
const KINDS = ["reminder_day_before", "reminder_same_day", "booking_confirmation"] as const;
const CHANNELS = ["whatsapp", "email"] as const;
const LOCALES = ["fr", "en"] as const;

export function MessageSettings() {
  const { t } = useI18n();
  const { can } = useCabinet();
  const [tab, setTab] = useState<"templates" | "whatsapp" | "log">("templates");
  return (
    <RequirePermission allowed={can.settings}>
      <PageHeader title={t("agenda.templates.title")} subtitle={t("agenda.templates.subtitle")} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "templates", label: t("agenda.templates.tabs.templates") },
          { value: "whatsapp", label: t("whatsapp.settings.tab") },
          { value: "log", label: t("agenda.templates.tabs.log") },
        ]}
      />
      <div className="mt-4">{tab === "templates" ? <TemplatesList /> : tab === "whatsapp" ? <WhatsAppSettings /> : <NotificationLog />}</div>
    </RequirePermission>
  );
}

function useSampleVars(locale: string): TemplateVars {
  const { t } = useI18n();
  const { cabinet } = useCabinet();
  void locale;
  return {
    patient_name: t("agenda.templates.sample.patient_name"),
    cabinet_name: cabinet?.name ?? "Cabinet",
    date: t("agenda.templates.sample.date"),
    time: t("agenda.templates.sample.time"),
    dentist_name: t("agenda.templates.sample.dentist_name"),
    cabinet_phone: formatPhone(cabinet?.phone) || "+224 620 00 00 00",
    patient_first_name: t("agenda.templates.sample.patient_name").split(" ")[0],
    cabinet_address: [cabinet?.address, cabinet?.city].filter(Boolean).join(", "),
  };
}

function TemplatesList() {
  const { t, locale } = useI18n();
  const cabinetId = useCabinetId();
  const { can } = useCabinet();
  type Preset = { kind: string; channel: string; locale: string };
  const [editing, setEditing] = useState<{ template: Template | null; preset?: Preset } | null>(null);
  const templates = useLiveQuery(
    async () => (await localDb().message_templates.where("cabinet_id").equals(cabinetId).toArray()).filter((x) => !x.deleted_at && x.kind !== "otp"),
    [cabinetId],
  );
  const vars = useSampleVars(locale);

  if (!templates) return null;

  return (
    <div className="flex flex-col gap-4">
      {can.settingsWrite && (
        <div>
          <Button onClick={() => setEditing({ template: null })}>
            <Plus className="size-4" />
            {t("agenda.templates.add")}
          </Button>
        </div>
      )}
      {KINDS.map((kind) => (
        <Card key={kind}>
          <div className="border-b border-border px-4 py-3 font-semibold">{t(`agenda.templates.kind.${kind}`)}</div>
          <ul className="divide-y divide-border">
            {CHANNELS.flatMap((channel) =>
              LOCALES.map((loc) => {
                const tpl = templates.find((x) => x.kind === kind && x.channel === channel && x.locale === loc);
                if (!tpl && loc !== "fr") return null;
                return (
                  <li key={`${channel}-${loc}`} className="flex items-start gap-3 px-4 py-3">
                    {channel === "email" ? <Mail className="mt-0.5 size-4 shrink-0 text-muted" /> : <MessageCircle className="mt-0.5 size-4 shrink-0 text-muted" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {t(`agenda.templates.channel.${channel}`)}
                        <Badge>{t(`agenda.templates.locale.${loc}`)}</Badge>
                        {tpl && !tpl.enabled && <Badge tone="warning">{t("agenda.templates.disabled")}</Badge>}
                      </div>
                      {tpl ? (
                        <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-muted">{renderTemplate(tpl.body, vars)}</p>
                      ) : (
                        <p className="mt-1 text-sm text-muted">{t("agenda.templates.missing")}</p>
                      )}
                    </div>
                    {can.settingsWrite && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditing(tpl ? { template: tpl } : { template: null, preset: { kind, channel, locale: loc } })}
                      >
                        {tpl ? t("common.edit") : t("common.add")}
                      </Button>
                    )}
                  </li>
                );
              }),
            )}
          </ul>
        </Card>
      ))}
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.template ? t("agenda.templates.edit") : t("agenda.templates.add")} size="lg">
        {editing && (
          <TemplateForm
            key={editing.template?.id ?? "new"}
            template={editing.template}
            preset={editing.preset}
            existing={templates}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function TemplateForm({
  template,
  preset,
  existing,
  onDone,
}: {
  template: Template | null;
  preset?: { kind: string; channel: string; locale: string };
  existing: Template[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const cabinetId = useCabinetId();
  const toast = useToast();
  const [kind, setKind] = useState<string>(template?.kind ?? preset?.kind ?? "reminder_day_before");
  const [channel, setChannel] = useState<string>(template?.channel ?? preset?.channel ?? "whatsapp");
  const [loc, setLoc] = useState<string>(template?.locale ?? preset?.locale ?? "fr");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState((template?.body ?? "").replace(/\\n/g, "\n"));
  const [enabled, setEnabled] = useState(template?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  // Position du curseur dans le texte (insertion des variables).
  const sel = useRef<[number, number] | null>(null);
  const vars = useSampleVars(loc);

  const duplicate = !template && existing.some((x) => x.kind === kind && x.channel === channel && x.locale === loc);
  const preview = renderTemplate(body, vars);
  const unknown = unknownVariables(body);
  const waPreview = channel === "whatsapp" ? whatsappParam(preview) : null;

  function insert(v: string) {
    const token = `{{${v}}}`;
    const [s, e] = sel.current ?? [body.length, body.length];
    setBody(body.slice(0, s) + token + body.slice(e));
    sel.current = [s + token.length, s + token.length];
  }

  async function save() {
    setError(null);
    if (!body.trim()) return setError(t("common.required"));
    if (duplicate) return setError(t("agenda.templates.exists"));
    await mutate("message_templates", {
      id: template?.id,
      cabinet_id: cabinetId,
      kind: kind as Template["kind"],
      channel: channel as Template["channel"],
      locale: loc,
      subject: channel === "email" ? subject.trim() || null : null,
      body: body.trim(),
      enabled,
    });
    toast(t("common.saved"));
    onDone();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("agenda.templates.kindLabel")}>
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)} disabled={!!template}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`agenda.templates.kind.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("agenda.templates.channelLabel")}>
          {(p) => (
            <Select {...p} value={channel} onChange={(e) => setChannel(e.target.value)} disabled={!!template}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`agenda.templates.channel.${c}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("agenda.templates.language")}>
          {(p) => (
            <Select {...p} value={loc} onChange={(e) => setLoc(e.target.value)} disabled={!!template}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {t(`agenda.templates.locale.${l}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {channel === "email" && (
        <Field label={t("agenda.templates.subject")}>
          {(p) => <Input {...p} value={subject} onChange={(e) => setSubject(e.target.value)} />}
        </Field>
      )}
      <Field label={t("agenda.templates.body")} required error={error}>
        {(p) => (
          <Textarea
            {...p}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onSelect={(e) => (sel.current = [e.currentTarget.selectionStart, e.currentTarget.selectionEnd])}
            className="min-h-32"
          />
        )}
      </Field>
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted">{t("agenda.templates.variables")}</div>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARIABLES.map((v) => (
            <button key={v} type="button" onClick={() => insert(v)} className="rounded-full border border-border px-2 py-0.5 font-mono text-xs hover:border-primary hover:text-primary">
              {`{{${v}}}`}
            </button>
          ))}
        </div>
        {unknown.length > 0 && <p className="mt-2 text-xs text-danger">{t("agenda.templates.unknownVariables", { list: unknown.join(", ") })}</p>}
      </div>
      <Checkbox label={t("agenda.templates.enabled")} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      <div>
        <div className="mb-1.5 text-xs font-medium uppercase text-muted">{t("agenda.templates.preview")}</div>
        <div className="rounded-lg border border-border bg-primary-soft p-3 text-sm">
          {channel === "email" && subject && <div className="mb-2 font-semibold">{renderTemplate(subject, vars)}</div>}
          <p className="whitespace-pre-line">{waPreview ?? preview}</p>
        </div>
        {channel === "whatsapp" && (
          <p className="mt-2 text-xs text-muted">
            {t("agenda.templates.whatsappNote")} {preview.length > 900 && <span className="text-danger">{t("agenda.templates.tooLong")}</span>}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button onClick={save} disabled={duplicate}>
          {t("common.save")}
        </Button>
      </div>
      {duplicate && <p className="text-sm text-danger">{t("agenda.templates.exists")}</p>}
    </div>
  );
}

type Log = Tables<"notification_log">;

function NotificationLog() {
  const { t, locale } = useI18n();
  const cabinetId = useCabinetId();
  const { cabinet } = useCabinet();
  const tz = cabinet?.timezone ?? "Africa/Conakry";
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "offline" | "error">("loading");

  const load = useCallback(async () => {
    if (!navigator.onLine) {
      setState("offline");
      return;
    }
    setState("loading");
    let q = supabase().from("notification_log").select("*").eq("cabinet_id", cabinetId).order("created_at", { ascending: false }).limit(200);
    if (status) q = q.eq("status", status as Log["status"]);
    if (channel) q = q.eq("channel", channel as Log["channel"]);
    const { data, error } = await q;
    if (error) {
      setState(/fetch/i.test(error.message) ? "offline" : "error");
      return;
    }
    setLogs(data);
    setState("ok");
  }, [cabinetId, status, channel]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement en ligne à l'affichage et au changement de filtre
    void load();
  }, [load]);

  const patients = useLiveQuery(async () => {
    const ids = [...new Set((logs ?? []).map((l) => l.patient_id).filter(Boolean))] as string[];
    return new Map((await localDb().patients.bulkGet(ids)).filter((p) => !!p).map((p) => [p!.id, fullName(p)]));
  }, [logs]);

  const rows = useMemo(() => logs ?? [], [logs]);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <Select aria-label={t("agenda.log.statusLabel")} value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 max-w-48">
          <option value="">{t("agenda.log.allStatuses")}</option>
          {(["queued", "sent", "delivered", "read", "failed"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`agenda.log.status.${s}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t("agenda.templates.channelLabel")} value={channel} onChange={(e) => setChannel(e.target.value)} className="h-9 max-w-48">
          <option value="">{t("agenda.log.allChannels")}</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {t(`agenda.templates.channel.${c}`)}
            </option>
          ))}
        </Select>
        <Button variant="ghost" size="sm" onClick={() => void load()} loading={state === "loading"} className="ml-auto">
          <RefreshCw className="size-4" />
          {t("agenda.log.refresh")}
        </Button>
      </div>
      {state === "offline" && <p className="p-4 text-sm text-muted">{t("agenda.log.offline")}</p>}
      {state === "error" && <p className="p-4 text-sm text-danger">{t("agenda.log.error")}</p>}
      {state === "ok" && rows.length === 0 && <EmptyState icon={<Mail />} title={t("agenda.log.empty")} />}
      {rows.length > 0 && state !== "offline" && (
        <>
          {/* Écran large : tableau ; téléphone : liste. */}
          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <Th>{t("agenda.log.date")}</Th>
                  <Th>{t("agenda.templates.kindLabel")}</Th>
                  <Th>{t("agenda.log.patient")}</Th>
                  <Th>{t("agenda.log.recipient")}</Th>
                  <Th>{t("agenda.log.statusLabel")}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(l.sent_at ?? l.created_at, locale, tz)}</Td>
                    <Td>
                      <div>{t(`agenda.templates.kind.${l.kind}`)}</div>
                      <div className="text-xs text-muted">{t(`agenda.templates.channel.${l.channel}`)}</div>
                    </Td>
                    <Td>{(l.patient_id && patients?.get(l.patient_id)) || "—"}</Td>
                    <Td className="whitespace-nowrap">{l.channel === "email" ? l.recipient : formatPhone(l.recipient)}</Td>
                    <Td>
                      <LogStatus log={l} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <ul className="divide-y divide-border sm:hidden">
            {rows.map((l) => (
              <li key={l.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{(l.patient_id && patients?.get(l.patient_id)) || l.recipient}</span>
                  <LogStatus log={l} />
                </div>
                <div className="text-xs text-muted">
                  {t(`agenda.templates.kind.${l.kind}`)} · {t(`agenda.templates.channel.${l.channel}`)} · {formatDateTime(l.sent_at ?? l.created_at, locale, tz)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function LogStatus({ log }: { log: Log }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="flex flex-wrap items-center gap-1">
        <Badge tone={logTone(log.status)}>{t(`agenda.log.status.${log.status}`)}</Badge>
        {isSandboxLog(log) && (
          <Badge tone="neutral">
            <span title={t("agenda.log.sandbox")}>{t("agenda.reminders.sandbox")}</span>
          </Badge>
        )}
      </span>
      {log.attempts > 1 && <span className="text-xs text-muted">{t("agenda.log.attempts", { count: log.attempts })}</span>}
      {log.status === "failed" && log.error && <span className="max-w-64 text-xs text-danger">{log.error}</span>}
    </div>
  );
}
