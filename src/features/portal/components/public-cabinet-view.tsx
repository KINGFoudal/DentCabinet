"use client";

import Link from "next/link";
import { CalendarPlus, Clock, Mail, MapPin, MessageCircle, Phone, Stethoscope, UserRound } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { formatPhone, normalizeGuineaPhone } from "@/lib/format";
import { todayISO } from "@/lib/dates";
import { hasOpeningHours, isoWeekday, weekRows } from "@/features/portal/lib/schedule";
import { logoUrl, type PublicCabinet } from "@/features/portal/lib/types";
import { PortalFooter, PortalHeader } from "./portal-header";

export function whatsappLink(phone: string | null | undefined): string | null {
  const e164 = phone ? normalizeGuineaPhone(phone) : null;
  return e164 ? `https://wa.me/${e164.slice(1)}` : null;
}

export function PublicCabinetView({ cabinet }: { cabinet: PublicCabinet }) {
  const t = useT();
  const phone = cabinet.phone ? (normalizeGuineaPhone(cabinet.phone) ?? cabinet.phone) : null;
  const wa = whatsappLink(cabinet.phone);
  const logo = logoUrl(cabinet.logo_path);
  const today = isoWeekday(todayISO(cabinet.timezone));
  const canBook = cabinet.online_booking_enabled && cabinet.appointment_types.length > 0;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <PortalHeader
        actions={
          <Link href="/patient" className="hidden text-sm font-medium text-primary hover:underline sm:inline">
            {t("portal.public.patientSpace")}
          </Link>
        }
      />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">
        <section className="flex flex-col gap-4 rounded-xl bg-primary-soft p-5">
          <div className="flex items-start gap-4">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- logo du cabinet, petit fichier déjà optimisé
              <img src={logo} alt="" width={64} height={64} className="size-16 shrink-0 rounded-xl border border-border bg-surface object-contain" />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-primary text-2xl font-semibold text-on-primary" aria-hidden>
                {cabinet.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-semibold sm:text-2xl">{cabinet.name}</h1>
              {cabinet.city && <p className="text-sm text-muted">{cabinet.city}</p>}
            </div>
          </div>
          {cabinet.description && <p className="whitespace-pre-line text-sm">{cabinet.description}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {canBook && (
              <Link href={`/c/${cabinet.slug}/rdv`} className={buttonClass("primary", "lg")}>
                <CalendarPlus className="size-5" />
                {t("portal.public.book")}
              </Link>
            )}
            <div className="flex gap-2">
              {phone && (
                <a href={`tel:${phone}`} className={buttonClass("secondary", "lg", "flex-1 sm:flex-none")}>
                  <Phone className="size-5" />
                  {t("portal.public.call")}
                </a>
              )}
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "lg", "flex-1 sm:flex-none")}>
                  <MessageCircle className="size-5" />
                  {t("portal.public.whatsapp")}
                </a>
              )}
            </div>
          </div>
          {!canBook && <p className="text-sm text-muted">{t("portal.public.bookingClosed")}</p>}
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader title={t("portal.public.contact")} />
            <CardBody className="flex flex-col gap-3 text-sm">
              {(cabinet.address || cabinet.city) && (
                <p className="flex gap-2">
                  <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
                  <span>{[cabinet.address, cabinet.city].filter(Boolean).join(", ")}</span>
                </p>
              )}
              {phone && (
                <a href={`tel:${phone}`} className="flex gap-2 text-primary hover:underline">
                  <Phone className="size-4 shrink-0" aria-hidden />
                  {formatPhone(phone)}
                </a>
              )}
              {cabinet.email && (
                <a href={`mailto:${cabinet.email}`} className="flex gap-2 break-all text-primary hover:underline">
                  <Mail className="size-4 shrink-0" aria-hidden />
                  {cabinet.email}
                </a>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("portal.public.hours")} />
            <CardBody>
              {hasOpeningHours(cabinet.opening_hours) ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {weekRows(cabinet.opening_hours).map((r) => (
                    <li
                      key={r.day}
                      className={cn("flex justify-between gap-3 rounded px-2 py-1", r.day === today && "bg-primary-soft font-medium")}
                    >
                      <span className="flex items-center gap-1.5">
                        {r.day === today && <Clock className="size-3.5 text-primary" aria-hidden />}
                        {t(`portal.days.d${r.day}`)}
                      </span>
                      <span className={cn("text-right", r.intervals.length === 0 && "text-muted")}>
                        {r.intervals.length ? r.intervals.map(([a, b]) => `${a}–${b}`).join(", ") : t("portal.public.closed")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{t("portal.public.noHours")}</p>
              )}
            </CardBody>
          </Card>

          {cabinet.dentists.length > 0 && (
            <Card>
              <CardHeader title={t("portal.public.practitioners")} />
              <CardBody>
                <ul className="flex flex-col gap-2 text-sm">
                  {cabinet.dentists.map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      <UserRound className="size-4 text-primary" aria-hidden />
                      {d.name ?? "—"}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {canBook && (
            <Card>
              <CardHeader title={t("portal.public.services")} />
              <CardBody>
                <ul className="flex flex-col gap-2 text-sm">
                  {cabinet.appointment_types.map((ty) => (
                    <li key={ty.id} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <Stethoscope className="size-4 text-primary" aria-hidden />
                        {ty.name}
                      </span>
                      <span className="text-muted">{t("portal.public.duration", { minutes: ty.duration_minutes })}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>
        <Link href="/patient" className="text-center text-sm font-medium text-primary hover:underline sm:hidden">
          {t("portal.public.patientSpace")}
        </Link>
      </main>
      <PortalFooter />
    </div>
  );
}

export function PublicCabinetNotFound() {
  const t = useT();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <PortalHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">{t("portal.public.notFoundTitle")}</h1>
        <p className="text-sm text-muted">{t("portal.public.notFoundText")}</p>
        <Link href="/" className={buttonClass("secondary")}>
          {t("portal.public.home")}
        </Link>
      </main>
    </div>
  );
}

export function PublicSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5" aria-busy>
      <div className="h-40 animate-pulse rounded-xl bg-primary-soft" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-32 animate-pulse rounded-xl border border-border bg-surface" />
        <div className="h-32 animate-pulse rounded-xl border border-border bg-surface" />
      </div>
    </div>
  );
}
