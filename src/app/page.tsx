"use client";

import Link from "next/link";
import { CalendarCheck, ClipboardList, Receipt, Smartphone, WifiOff, ShieldCheck } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";

const features = [
  { icon: CalendarCheck, key: "agenda" },
  { icon: ClipboardList, key: "file" },
  { icon: Receipt, key: "billing" },
  { icon: WifiOff, key: "offline" },
  { icon: Smartphone, key: "portal" },
  { icon: ShieldCheck, key: "security" },
];

export default function Home() {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- icône SVG statique */}
          <img src="/icon.svg" alt="" className="size-9" />
          <span className="text-lg font-semibold text-primary">{t("common.appName")}</span>
        </div>
        <Link href="/connexion" className={buttonClass("secondary", "sm")}>
          {t("home.login")}
        </Link>
      </header>
      <section className="bg-primary-soft">
        <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:py-24">
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{t("home.title")}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">{t("home.subtitle")}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/inscription" className={buttonClass("primary", "lg")}>
              {t("home.trial")}
            </Link>
            <Link href="/connexion" className={buttonClass("secondary", "lg")}>
              {t("home.haveAccount")}
            </Link>
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-5xl gap-4 px-4 py-12 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.key} className="rounded-xl border border-border bg-surface p-5">
            <f.icon className="size-6 text-primary" />
            <h2 className="mt-3 font-semibold">{t(`home.features.${f.key}Title`)}</h2>
            <p className="mt-1 text-sm text-muted">{t(`home.features.${f.key}Text`)}</p>
          </div>
        ))}
      </section>
      <footer className="mt-auto border-t border-border py-6 text-center text-sm text-muted">{t("common.appName")}</footer>
    </div>
  );
}
