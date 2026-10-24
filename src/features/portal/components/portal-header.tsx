"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/components/i18n-provider";
import { LOCALES } from "@/i18n/messages";
import { cn } from "@/components/ui/cn";

/** Sélecteur fr / en. */
export function LocaleSwitch({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t("portal.language")} className={cn("flex rounded-lg border border-border p-0.5 text-xs", className)}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={cn(
            "min-w-9 rounded-md px-2 py-1 font-medium uppercase",
            locale === l ? "bg-primary text-on-primary" : "text-muted hover:text-text",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** En-tête léger des pages publiques et de l'espace patient. */
export function PortalHeader({ href = "/", title, actions }: { href?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="no-print border-b border-border bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
        <Link href={href} className="flex min-w-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- icône SVG statique */}
          <img src="/icon.svg" alt="" className="size-7 shrink-0" />
          <span className="truncate font-semibold text-primary">{title ?? "Nimba Dentaire"}</span>
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
          <LocaleSwitch />
        </div>
      </div>
    </header>
  );
}

export function PortalFooter() {
  const { t } = useI18n();
  return <footer className="no-print mt-auto py-6 text-center text-xs text-muted">{t("portal.poweredBy")}</footer>;
}
