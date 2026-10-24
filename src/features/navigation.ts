import { Calendar, CreditCard, Gauge, LayoutDashboard, Settings, Shield, Sofa, Users, BarChart3 } from "lucide-react";
import type { Permissions } from "@/lib/permissions";

export type NavItem = {
  href: string;
  labelKey: string;
  /** Libellé court pour la barre du bas sur mobile. */
  shortKey?: string;
  icon: typeof Calendar;
  /** Affiché si la fonction renvoie vrai. */
  visible?: (can: Permissions, ctx: { isPlatformAdmin: boolean }) => boolean;
  /** Présent dans la barre du bas sur mobile. */
  mobile?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/app", labelKey: "nav.dashboard", shortKey: "nav.home", icon: LayoutDashboard, mobile: true },
  { href: "/app/agenda", labelKey: "nav.agenda", icon: Calendar, mobile: true },
  { href: "/app/salle-attente", labelKey: "nav.waitingRoom", icon: Sofa },
  { href: "/app/patients", labelKey: "nav.patients", icon: Users, mobile: true },
  { href: "/app/facturation", labelKey: "nav.billing", icon: CreditCard, mobile: true, visible: (c) => c.billingRead },
  { href: "/app/rapports", labelKey: "nav.reports", icon: BarChart3, visible: (c) => c.reports },
  { href: "/app/abonnement", labelKey: "nav.subscription", icon: Gauge, visible: (c) => c.subscription },
  { href: "/app/parametres", labelKey: "nav.settings", icon: Settings, visible: (c) => c.settings },
  { href: "/admin", labelKey: "nav.admin", icon: Shield, visible: (_c, x) => x.isPlatformAdmin },
];

/** Sous-pages des paramètres (page /app/parametres). */
export const SETTINGS_SECTIONS = [
  { href: "/app/parametres/cabinet", labelKey: "settings.sections.cabinet", descKey: "settings.sections.cabinetDesc" },
  { href: "/app/parametres/equipe", labelKey: "settings.sections.team", descKey: "settings.sections.teamDesc" },
  { href: "/app/parametres/agenda", labelKey: "settings.sections.agenda", descKey: "settings.sections.agendaDesc" },
  { href: "/app/parametres/actes", labelKey: "settings.sections.acts", descKey: "settings.sections.actsDesc" },
  { href: "/app/parametres/messages", labelKey: "settings.sections.messages", descKey: "settings.sections.messagesDesc" },
] as const;
