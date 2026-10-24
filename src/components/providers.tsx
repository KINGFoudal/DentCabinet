"use client";

import type { ReactNode } from "react";
import { I18nProvider } from "@/components/i18n-provider";
import { AuthProvider } from "@/lib/auth/auth-provider";
import { CabinetProvider } from "@/lib/cabinet/cabinet-provider";
import { ToastProvider } from "@/components/ui/toast";
import { ServiceWorker } from "@/components/service-worker";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <AuthProvider>
        <CabinetProvider>
          <ToastProvider>{children}</ToastProvider>
        </CabinetProvider>
      </AuthProvider>
      <ServiceWorker />
    </I18nProvider>
  );
}
