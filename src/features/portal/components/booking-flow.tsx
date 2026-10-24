"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarCheck, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/auth-provider";
import { useI18n } from "@/components/i18n-provider";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, Spinner } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { cn } from "@/components/ui/cn";
import { formatPhone, formatTime } from "@/lib/format";
import { addDays, todayISO } from "@/lib/dates";
import { errorKey, rpcErrorCode } from "@/features/portal/lib/errors";
import {
  authPhoneToE164,
  isOpenOn,
  longDate,
  nextDays,
  shortDayLabel,
  splitSlots,
  type Slot,
} from "@/features/portal/lib/schedule";
import type { PortalCabinet, PublicCabinet } from "@/features/portal/lib/types";
import { PortalFooter, PortalHeader } from "./portal-header";
import { PhoneLogin } from "./phone-login";

const DAYS_SHOWN = 14;
const MAX_DAYS = 60; // même horizon que available_slots

type Step = "choose" | "identify" | "details" | "confirm" | "done";
type SlotsState = { key: string; slots: Slot[]; error: string | null };

export function BookingFlow({ cabinet }: { cabinet: PublicCabinet }) {
  const { t, locale } = useI18n();
  const { user, signOut } = useAuth();
  const tz = cabinet.timezone;
  const today = todayISO(tz);
  const days = useMemo(() => nextDays(today, DAYS_SHOWN), [today]);
  const firstOpen = days.find((d) => isOpenOn(cabinet.opening_hours, d)) ?? today;

  const [step, setStep] = useState<Step>("choose");
  const [typeId, setTypeId] = useState(cabinet.appointment_types.length === 1 ? cabinet.appointment_types[0].id : "");
  const [dentistId, setDentistId] = useState("");
  const [date, setDate] = useState(firstOpen);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [reload, setReload] = useState(0);
  const [slotsState, setSlotsState] = useState<SlotsState | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [needsName, setNeedsName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState<{ starts_at: string; dentist_id: string } | null>(null);

  const type = cabinet.appointment_types.find((x) => x.id === typeId) ?? null;
  const dentistName = (id: string | null | undefined) => cabinet.dentists.find((d) => d.id === id)?.name ?? null;
  const userPhone = authPhoneToE164(user?.phone);

  const slotsKey = typeId ? `${typeId}|${dentistId}|${date}|${reload}` : "";
  useEffect(() => {
    if (!slotsKey) return;
    let cancelled = false;
    supabase()
      .rpc("available_slots", { p_slug: cabinet.slug, p_type: typeId, p_date: date, ...(dentistId ? { p_dentist: dentistId } : {}) })
      .then(({ data, error }) => {
        if (cancelled) return;
        setSlotsState({ key: slotsKey, slots: data ?? [], error: error ? errorKey(error) : null });
      });
    return () => {
      cancelled = true;
    };
  }, [slotsKey, cabinet.slug, typeId, dentistId, date]);

  const slotsLoading = !!slotsKey && slotsState?.key !== slotsKey;
  const slots = slotsLoading ? [] : (slotsState?.slots ?? []);
  const groups = splitSlots(slots, tz);

  function pick<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setSlot(null);
      setError(null);
    };
  }

  /** Après connexion : le patient a-t-il déjà une fiche dans ce cabinet ? */
  async function afterIdentified() {
    const { data } = await supabase().rpc("portal_cabinets");
    const known = Array.isArray(data) && (data as unknown as PortalCabinet[]).some((c) => c.id === cabinet.id);
    setNeedsName(!known);
    setStep(known ? "confirm" : "details");
  }

  async function goNext() {
    if (!slot) {
      setError(t("portal.booking.chooseSlot"));
      return;
    }
    setError(null);
    if (!userPhone) {
      setStep("identify");
      return;
    }
    setBusy(true);
    await afterIdentified();
    setBusy(false);
  }

  async function confirm() {
    if (!slot || !type) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase().rpc("book_online", {
      p_slug: cabinet.slug,
      p_type: type.id,
      p_starts_at: slot.starts_at,
      ...(dentistId ? { p_dentist: dentistId } : {}),
      ...(needsName ? { p_first_name: firstName.trim(), p_last_name: lastName.trim() } : {}),
    });
    setBusy(false);
    if (error) {
      const code = rpcErrorCode(error);
      setError(t(errorKey(error)));
      if (code === "slot_unavailable") {
        setSlot(null);
        setReload((r) => r + 1);
        setStep("choose");
      } else if (code === "name_required") {
        setNeedsName(true);
        setStep("details");
      } else if (code === "phone_not_verified" || code === "not_authenticated") {
        setStep("identify");
      }
      return;
    }
    const r = data as { starts_at: string; dentist_id: string };
    setBooked({ starts_at: r.starts_at ?? slot.starts_at, dentist_id: r.dentist_id });
    setStep("done");
  }

  const when = (iso: string) => t("portal.booking.when", { date: longDate(iso, locale, tz), time: formatTime(iso, locale, tz) });

  if (!cabinet.online_booking_enabled || cabinet.appointment_types.length === 0) {
    return (
      <Shell cabinet={cabinet}>
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p className="text-sm">{t("portal.public.bookingClosed")}</p>
            <Link href={`/c/${cabinet.slug}`} className={buttonClass("secondary")}>
              {t("portal.booking.backToCabinet")}
            </Link>
          </CardBody>
        </Card>
      </Shell>
    );
  }

  if (step === "done" && booked) {
    return (
      <Shell cabinet={cabinet}>
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className="size-12 text-success" aria-hidden />
            <h1 className="text-lg font-semibold">{t("portal.booking.successTitle")}</h1>
            <p>
              {t("portal.booking.successText", {
                date: longDate(booked.starts_at, locale, tz),
                time: formatTime(booked.starts_at, locale, tz),
                cabinet: cabinet.name,
              })}
            </p>
            {type && <p className="text-sm text-muted">{type.name}</p>}
            {dentistName(booked.dentist_id) && (
              <p className="text-sm text-muted">{t("portal.booking.with", { name: dentistName(booked.dentist_id)! })}</p>
            )}
            <p className="text-sm text-muted">{t("portal.booking.successHint")}</p>
            <div className="mt-2 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Link href="/patient" className={buttonClass("primary", "lg")}>
                {t("portal.booking.goPortal")}
              </Link>
              <Link href={`/c/${cabinet.slug}`} className={buttonClass("secondary", "lg")}>
                {t("portal.booking.backToCabinet")}
              </Link>
            </div>
          </CardBody>
        </Card>
      </Shell>
    );
  }

  const summary = slot && type && (
    <div className="rounded-lg bg-primary-soft p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{type.name}</p>
          <p>{when(slot.starts_at)}</p>
          {dentistId && dentistName(dentistId) && <p className="text-muted">{t("portal.booking.with", { name: dentistName(dentistId)! })}</p>}
        </div>
        <button type="button" className="shrink-0 text-primary hover:underline" onClick={() => setStep("choose")}>
          {t("portal.booking.change")}
        </button>
      </div>
    </div>
  );

  return (
    <Shell cabinet={cabinet}>
      <div className="flex items-center gap-2">
        <Link
          href={step === "choose" ? `/c/${cabinet.slug}` : "#"}
          onClick={(e) => {
            if (step !== "choose") {
              e.preventDefault();
              setError(null);
              setStep("choose");
            }
          }}
          className={buttonClass("ghost", "sm", "-ml-2")}
          aria-label={t("portal.back")}
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">{t("portal.booking.title")}</h1>
      </div>

      {step === "choose" && (
        <>
          <Section title={t("portal.booking.stepType")}>
            <div className="grid gap-2 sm:grid-cols-2">
              {cabinet.appointment_types.map((ty) => (
                <button
                  key={ty.id}
                  type="button"
                  aria-pressed={typeId === ty.id}
                  onClick={() => pick(setTypeId)(ty.id)}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left text-sm",
                    typeId === ty.id ? "border-primary bg-primary-soft font-medium" : "border-border bg-surface hover:border-primary",
                  )}
                >
                  <span>{ty.name}</span>
                  <span className="text-xs text-muted">{t("portal.public.duration", { minutes: ty.duration_minutes })}</span>
                </button>
              ))}
            </div>
          </Section>

          {cabinet.dentists.length > 1 && (
            <Section title={t("portal.booking.stepDentist")}>
              <Select value={dentistId} onChange={(e) => pick(setDentistId)(e.target.value)} aria-label={t("portal.booking.stepDentist")}>
                <option value="">{t("portal.booking.anyDentist")}</option>
                {cabinet.dentists.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name ?? "—"}
                  </option>
                ))}
              </Select>
            </Section>
          )}

          {typeId && (
            <Section title={t("portal.booking.stepDate")}>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {days.map((d) => {
                  const open = isOpenOn(cabinet.opening_hours, d);
                  const l = shortDayLabel(d, locale);
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={!open}
                      aria-pressed={date === d}
                      onClick={() => pick(setDate)(d)}
                      className={cn(
                        "flex w-16 shrink-0 flex-col items-center rounded-lg border px-1 py-2 text-xs",
                        date === d ? "border-primary bg-primary text-on-primary" : "border-border bg-surface hover:border-primary",
                        !open && "opacity-40",
                      )}
                    >
                      <span className="capitalize">{l.weekday}</span>
                      <span className="font-medium">{l.day}</span>
                    </button>
                  );
                })}
              </div>
              <Field label={t("portal.booking.otherDate")} className="mt-3 max-w-56">
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    min={today}
                    max={addDays(today, MAX_DAYS)}
                    value={date}
                    onChange={(e) => e.target.value && pick(setDate)(e.target.value)}
                  />
                )}
              </Field>
            </Section>
          )}

          {typeId && (
            <Section title={t("portal.booking.stepSlot")}>
              <p className="mb-2 text-sm font-medium first-letter:uppercase">{longDate(`${date}T12:00:00Z`, locale, "UTC")}</p>
              {slotsLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              ) : slotsState?.error ? (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-sm text-danger">{t(slotsState.error)}</p>
                  <Button variant="secondary" size="sm" onClick={() => setReload((r) => r + 1)}>
                    {t("portal.retry")}
                  </Button>
                </div>
              ) : slots.length === 0 ? (
                <p className="text-sm text-muted">{t("portal.booking.noSlots")}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {(["morning", "afternoon"] as const).map(
                    (g) =>
                      groups[g].length > 0 && (
                        <div key={g}>
                          <p className="mb-1.5 text-xs font-medium uppercase text-muted">{t(`portal.booking.${g}`)}</p>
                          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                            {groups[g].map((s) => (
                              <button
                                key={s.starts_at}
                                type="button"
                                aria-pressed={slot?.starts_at === s.starts_at}
                                onClick={() => {
                                  setSlot(s);
                                  setError(null);
                                }}
                                className={cn(
                                  "h-10 rounded-lg border text-sm font-medium",
                                  slot?.starts_at === s.starts_at
                                    ? "border-primary bg-primary text-on-primary"
                                    : "border-border bg-surface hover:border-primary",
                                )}
                              >
                                {formatTime(s.starts_at, locale, tz)}
                              </button>
                            ))}
                          </div>
                        </div>
                      ),
                  )}
                </div>
              )}
            </Section>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
            {slot && <p className="mb-2 text-sm">{when(slot.starts_at)}</p>}
            <Button size="lg" className="w-full sm:w-auto" disabled={!slot} loading={busy} onClick={goNext}>
              {t("portal.booking.continue")}
            </Button>
          </div>
        </>
      )}

      {step === "identify" && (
        <Card>
          <CardBody className="flex flex-col gap-4">
            {summary}
            <div>
              <h2 className="font-semibold">{t("portal.booking.stepIdentify")}</h2>
              <p className="text-sm text-muted">{t("portal.booking.identifyHint")}</p>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <PhoneLogin onDone={afterIdentified} />
          </CardBody>
        </Card>
      )}

      {step === "details" && (
        <Card>
          <CardBody>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!firstName.trim() || !lastName.trim()) {
                  setError(t("portal.errors.name_required"));
                  return;
                }
                setError(null);
                setStep("confirm");
              }}
            >
              {summary}
              <div>
                <h2 className="font-semibold">{t("portal.booking.stepDetails")}</h2>
                <p className="text-sm text-muted">{t("portal.booking.detailsHint")}</p>
              </div>
              <Field label={t("portal.booking.firstName")} required>
                {(p) => <Input {...p} autoComplete="given-name" maxLength={100} value={firstName} onChange={(e) => setFirstName(e.target.value)} />}
              </Field>
              <Field label={t("portal.booking.lastName")} required error={error}>
                {(p) => <Input {...p} autoComplete="family-name" maxLength={100} value={lastName} onChange={(e) => setLastName(e.target.value)} />}
              </Field>
              <Button type="submit" size="lg">
                {t("portal.booking.continue")}
              </Button>
            </form>
          </CardBody>
        </Card>
      )}

      {step === "confirm" && slot && type && (
        <Card>
          <CardBody className="flex flex-col gap-4">
            <h2 className="flex items-center gap-2 font-semibold">
              <CalendarCheck className="size-5 text-primary" aria-hidden />
              {t("portal.booking.summary")}
            </h2>
            {summary}
            <div className="text-sm">
              <p className="font-medium">{cabinet.name}</p>
              {needsName && (
                <p>
                  {firstName.trim()} {lastName.trim().toUpperCase()}
                </p>
              )}
              {authPhoneToE164(user?.phone) && <p className="text-muted">{t("portal.booking.phone", { phone: formatPhone(authPhoneToE164(user?.phone)) })}</p>}
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button size="lg" loading={busy} onClick={confirm}>
              {t("portal.booking.confirm")}
            </Button>
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={async () => {
                await signOut();
                setError(null);
                setStep("identify");
              }}
            >
              {t("portal.booking.notYou")} {t("portal.booking.useOtherNumber")}
            </button>
          </CardBody>
        </Card>
      )}
    </Shell>
  );
}

function Shell({ cabinet, children }: { cabinet: PublicCabinet; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <PortalHeader href={`/c/${cabinet.slug}`} title={cabinet.name} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">{children}</main>
      <PortalFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
