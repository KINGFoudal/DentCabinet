"use client";

import { AdminGate, AdminPage } from "@/features/admin/components/admin-page";

export default function PlatformAdminPage() {
  return (
    <AdminGate>
      <AdminPage />
    </AdminGate>
  );
}
