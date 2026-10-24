"use client";

import Link from "next/link";
import { NAV_ITEMS } from "@/features/navigation";
import { useCabinet } from "@/lib/cabinet/cabinet-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { useT } from "@/components/i18n-provider";
import { Card } from "@/components/ui/card";

export default function MenuPage() {
  const { can, isPlatformAdmin } = useCabinet();
  const { signOut } = useAuth();
  const t = useT();
  const items = NAV_ITEMS.filter((i) => !i.visible || i.visible(can, { isPlatformAdmin }));
  return (
    <Card className="divide-y divide-border">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="flex items-center gap-3 px-4 py-3 hover:bg-primary-soft">
          <i.icon className="size-5 text-primary" />
          {t(i.labelKey)}
        </Link>
      ))}
      <button type="button" onClick={signOut} className="w-full px-4 py-3 text-left text-danger">
        {t("auth.logout")}
      </button>
    </Card>
  );
}
