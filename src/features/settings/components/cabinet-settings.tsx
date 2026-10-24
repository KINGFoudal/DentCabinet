"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ImageUp, Trash2 } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { mutate } from "@/lib/sync/mutate";
import { supabase } from "@/lib/supabase/client";
import { formatPhone, normalizeGuineaPhone } from "@/lib/format";
import type { Row } from "@/lib/local/db";
import { Card, CardBody, CardHeader, PageHeader, PageSpinner } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { RequirePermission } from "@/components/app/app-gate";
import { invalidDays, normalizeOpeningHours, parseOpeningHours, type OpeningHours } from "../opening-hours";
import { OpeningHoursEditor } from "./opening-hours-editor";

const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
const LOGO_MAX = 2 * 1024 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function logoUrl(cabinet: Pick<Row<"cabinets">, "logo_path" | "updated_at">) {
  if (!cabinet.logo_path) return null;
  const url = supabase().storage.from("branding").getPublicUrl(cabinet.logo_path).data.publicUrl;
  return `${url}?v=${encodeURIComponent(cabinet.updated_at)}`;
}

export function CabinetSettings() {
  const { can, cabinet } = useCabinet();
  const { t } = useI18n();
  return (
    <RequirePermission allowed={can.settings}>
      <Link href="/app/parametres" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" />
        {t("nav.settings")}
      </Link>
      <PageHeader title={t("settings.cabinet.title")} />
      {cabinet ? <CabinetForm key={cabinet.id} cabinet={cabinet} /> : <PageSpinner />}
    </RequirePermission>
  );
}

type Form = {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  public_description: string;
  public_page_enabled: boolean;
  online_booking_enabled: boolean;
  online_cancel_min_hours: string;
  locale: "fr" | "en";
  opening_hours: OpeningHours;
};

function toForm(c: Row<"cabinets">): Form {
  return {
    name: c.name,
    phone: c.phone ? formatPhone(c.phone) : "",
    email: c.email ?? "",
    address: c.address ?? "",
    city: c.city ?? "",
    public_description: c.public_description ?? "",
    public_page_enabled: c.public_page_enabled,
    online_booking_enabled: c.online_booking_enabled,
    online_cancel_min_hours: String(c.online_cancel_min_hours),
    locale: c.locale === "en" ? "en" : "fr",
    opening_hours: parseOpeningHours(c.opening_hours),
  };
}

function CabinetForm({ cabinet }: { cabinet: Row<"cabinets"> }) {
  const { t } = useI18n();
  const { can } = useCabinet();
  const toast = useToast();
  const [form, setForm] = useState<Form>(() => toForm(cabinet));
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [saving, setSaving] = useState(false);
  const disabled = !can.settingsWrite;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!form.name.trim()) errs.name = t("settings.cabinet.nameRequired");
    const phone = form.phone.trim() ? normalizeGuineaPhone(form.phone) : null;
    if (form.phone.trim() && !phone) errs.phone = t("settings.cabinet.phoneInvalid");
    if (form.email.trim() && !EMAIL.test(form.email.trim())) errs.email = t("settings.cabinet.emailInvalid");
    const hours = Math.max(0, Math.min(720, Math.round(Number(form.online_cancel_min_hours) || 0)));
    if (invalidDays(form.opening_hours).length) errs.opening_hours = t("settings.cabinet.rangeInvalid");
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await mutate("cabinets", {
        id: cabinet.id,
        name: form.name.trim(),
        phone,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        public_description: form.public_description.trim() || null,
        public_page_enabled: form.public_page_enabled,
        online_booking_enabled: form.online_booking_enabled,
        online_cancel_min_hours: hours,
        locale: form.locale,
        opening_hours: normalizeOpeningHours(form.opening_hours),
      });
      toast(navigator.onLine ? t("settings.cabinet.saved") : t("settings.cabinet.offlineSaved"));
    } finally {
      setSaving(false);
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <form onSubmit={save} className="flex flex-col gap-4" noValidate>
      {disabled && can.settings && <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{t("settings.readOnly")}</p>}

      <Card>
        <CardHeader title={t("settings.cabinet.identity")} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label={t("settings.cabinet.name")} error={errors.name} required className="sm:col-span-2">
            {(p) => <Input {...p} value={form.name} disabled={disabled} onChange={(e) => set("name", e.target.value)} />}
          </Field>
          <Field label={t("settings.cabinet.phone")} error={errors.phone}>
            {(p) => (
              <Input {...p} type="tel" inputMode="tel" value={form.phone} disabled={disabled} onChange={(e) => set("phone", e.target.value)} />
            )}
          </Field>
          <Field label={t("settings.cabinet.email")} error={errors.email}>
            {(p) => <Input {...p} type="email" value={form.email} disabled={disabled} onChange={(e) => set("email", e.target.value)} />}
          </Field>
          <Field label={t("settings.cabinet.address")}>
            {(p) => <Input {...p} value={form.address} disabled={disabled} onChange={(e) => set("address", e.target.value)} />}
          </Field>
          <Field label={t("settings.cabinet.city")}>
            {(p) => <Input {...p} value={form.city} disabled={disabled} onChange={(e) => set("city", e.target.value)} />}
          </Field>
          <Field label={t("settings.cabinet.language")}>
            {(p) => (
              <Select {...p} value={form.locale} disabled={disabled} onChange={(e) => set("locale", e.target.value as "fr" | "en")}>
                <option value="fr">{t("settings.cabinet.languageFr")}</option>
                <option value="en">{t("settings.cabinet.languageEn")}</option>
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>

      <LogoCard cabinet={cabinet} disabled={disabled} />

      <Card>
        <CardHeader title={t("settings.cabinet.publicTitle")} />
        <CardBody className="flex flex-col gap-4">
          <div className="text-sm">
            <div className="font-medium">{t("settings.cabinet.publicUrl")}</div>
            <a href={`/c/${cabinet.slug}`} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
              {origin}/c/{cabinet.slug}
            </a>
          </div>
          <Field label={t("settings.cabinet.description")} hint={t("settings.cabinet.descriptionHint")}>
            {(p) => (
              <Textarea
                {...p}
                rows={4}
                maxLength={2000}
                value={form.public_description}
                disabled={disabled}
                onChange={(e) => set("public_description", e.target.value)}
              />
            )}
          </Field>
          <Checkbox
            label={t("settings.cabinet.publicPage")}
            checked={form.public_page_enabled}
            disabled={disabled}
            onChange={(e) => set("public_page_enabled", e.target.checked)}
          />
          <Checkbox
            label={t("settings.cabinet.onlineBooking")}
            checked={form.online_booking_enabled}
            disabled={disabled}
            onChange={(e) => set("online_booking_enabled", e.target.checked)}
          />
          <Field label={t("settings.cabinet.cancelDelay")} hint={t("settings.cabinet.cancelDelayHint")} className="sm:max-w-xs">
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                max={720}
                inputMode="numeric"
                value={form.online_cancel_min_hours}
                disabled={disabled}
                onChange={(e) => set("online_cancel_min_hours", e.target.value)}
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("settings.cabinet.hoursTitle")} />
        <CardBody className="py-0">
          <OpeningHoursEditor value={form.opening_hours} onChange={(v) => set("opening_hours", v)} disabled={disabled} />
        </CardBody>
      </Card>

      {errors.opening_hours && <p className="text-sm text-danger">{errors.opening_hours}</p>}

      <div className="sticky bottom-16 z-10 flex justify-end lg:bottom-4">
        <Button type="submit" size="lg" loading={saving} disabled={disabled} className="shadow-lg">
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

function LogoCard({ cabinet, disabled }: { cabinet: Row<"cabinets">; disabled: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = logoUrl(cabinet);

  async function upload(file: File) {
    setError(null);
    const ext = LOGO_TYPES[file.type];
    if (!ext) return setError(t("settings.cabinet.logoType"));
    if (file.size > LOGO_MAX) return setError(t("settings.cabinet.logoTooBig"));
    if (!navigator.onLine) return setError(t("settings.cabinet.logoOffline"));
    setBusy(true);
    try {
      const path = `${cabinet.id}/logo.${ext}`;
      const { error: upError } = await supabase()
        .storage.from("branding")
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
      if (upError) throw upError;
      await mutate("cabinets", { id: cabinet.id, logo_path: path });
      toast(t("settings.cabinet.logoUploaded"));
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader title={t("settings.cabinet.logoTitle")} />
      <CardBody className="flex flex-wrap items-center gap-4">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-xl border border-border bg-background">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- image du stockage Supabase
            <img src={url} alt="" className="size-full object-contain" />
          ) : (
            <ImageUp className="size-8 text-muted" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept={Object.keys(LOGO_TYPES).join(",")}
              className="hidden"
              onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
            />
            <Button variant="secondary" loading={busy} disabled={disabled} onClick={() => input.current?.click()}>
              <ImageUp className="size-4" />
              {t("settings.cabinet.logoUpload")}
            </Button>
            {cabinet.logo_path && (
              <Button variant="ghost" disabled={disabled || busy} onClick={() => void mutate("cabinets", { id: cabinet.id, logo_path: null })}>
                <Trash2 className="size-4" />
                {t("settings.cabinet.logoRemove")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">{t("settings.cabinet.logoHint")}</p>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      </CardBody>
    </Card>
  );
}
