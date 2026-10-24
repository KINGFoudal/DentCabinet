"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SETTINGS_SECTIONS } from "@/features/navigation";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { useT } from "@/components/i18n-provider";
import { Card, PageHeader } from "@/components/ui/card";
import { RequirePermission } from "@/components/app/app-gate";

export default function SettingsPage() {
  const { can } = useCabinet();
  const t = useT();
  return (
    <RequirePermission allowed={can.settings}>
      <PageHeader title={t("nav.settings")} />
      <Card className="divide-y divide-border">
        {SETTINGS_SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="flex items-center gap-3 px-4 py-3 hover:bg-primary-soft">
            <div className="flex-1">
              <div className="font-medium">{t(s.labelKey)}</div>
              <div className="text-sm text-muted">{t(s.descKey)}</div>
            </div>
            <ChevronRight className="size-4 text-muted" />
          </Link>
        ))}
      </Card>
    </RequirePermission>
  );
}
