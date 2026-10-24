import { AppGate } from "@/components/app/app-gate";
import { AppShell } from "@/components/app/app-shell";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <AppGate>
      <AppShell>{children}</AppShell>
    </AppGate>
  );
}
