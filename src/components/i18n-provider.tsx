"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { translate, type Locale } from "@/i18n/messages";

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "nimba-locale";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("fr");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique de la préférence au montage
      if (saved === "fr" || saved === "en") setLocaleState(saved);
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {}
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);

  return <I18nContext value={{ locale, setLocale, t }}>{children}</I18nContext>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

/** Raccourci : const t = useT(); t("common.save") */
export function useT() {
  return useI18n().t;
}
