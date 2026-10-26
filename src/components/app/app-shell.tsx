"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LogOut, Menu } from "lucide-react";
import { NAV_ITEMS } from "@/features/navigation";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { useI18n } from "@/components/i18n-provider";
import { SyncStatus } from "./sync-status";
import { GlobalShortcuts } from "./shortcuts";
import { cn } from "@/components/ui/cn";
import { Select } from "@/components/ui/input";

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { can, isPlatformAdmin, memberships, cabinetId, selectCabinet, readOnly, cabinet } = useCabinet();
  const { signOut, user } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const items = NAV_ITEMS.filter((i) => !i.visible || i.visible(can, { isPlatformAdmin }));

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <Link href="/app" className="flex items-center gap-2 px-4 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- icône SVG statique */}
          <img src="/icon.svg" alt="" className="size-8" />
          <span className="font-semibold text-primary">Nimba Dentaire</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
                isActive(pathname, i.href) ? "bg-primary-soft font-medium text-primary" : "text-text hover:bg-primary-soft",
              )}
            >
              <i.icon className="size-4" />
              {t(i.labelKey)}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-3 text-xs text-muted">
          <div className="truncate">{user?.email}</div>
          <button type="button" onClick={signOut} className="mt-2 inline-flex items-center gap-1.5 hover:text-danger">
            <LogOut className="size-3.5" />
            {t("auth.logout")}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur sm:px-4">
          {memberships.length > 1 ? (
            <Select
              aria-label={t("auth.chooseCabinet")}
              value={cabinetId ?? ""}
              onChange={(e) => selectCabinet(e.target.value)}
              className="h-9 max-w-56"
            >
              {memberships.map((m) => (
                <option key={m.cabinet_id} value={m.cabinet_id}>
                  {m.cabinet.name}
                </option>
              ))}
            </Select>
          ) : (
            <span className="truncate font-medium">{cabinet?.name ?? memberships[0]?.cabinet.name}</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <GlobalShortcuts />
            <SyncStatus />
            <Select
              aria-label="Langue"
              value={locale}
              onChange={(e) => setLocale(e.target.value as "fr" | "en")}
              className="h-9 w-16 px-2"
            >
              <option value="fr">FR</option>
              <option value="en">EN</option>
            </Select>
            <button type="button" onClick={signOut} className="rounded-lg p-2 text-muted hover:text-danger lg:hidden" aria-label={t("auth.logout")}>
              <LogOut className="size-4" />
            </button>
          </div>
        </header>

        {readOnly && (
          <div className="no-print bg-warning-soft px-4 py-2 text-sm text-warning">
            {t("sync.readOnlyBanner")}{" "}
            {can.subscription && (
              <Link href="/app/abonnement" className="font-medium underline">
                {t("nav.subscription")}
              </Link>
            )}
          </div>
        )}

        <main className="flex flex-1 flex-col p-3 pb-24 sm:p-6 lg:pb-6">{children}</main>

        <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface lg:hidden">
          {items
            .filter((i) => i.mobile)
            .map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 text-[11px]",
                  isActive(pathname, i.href) ? "text-primary" : "text-muted",
                )}
              >
                <i.icon className="size-5" />
                {t(i.shortKey ?? i.labelKey)}
              </Link>
            ))}
          <Link
            href="/app/menu"
            className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", pathname === "/app/menu" ? "text-primary" : "text-muted")}
          >
            <Menu className="size-5" />
            {t("nav.more")}
          </Link>
        </nav>
      </div>
    </div>
  );
}
