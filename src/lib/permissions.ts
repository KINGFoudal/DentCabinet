import type { Enums } from "@/lib/database.types";

export type Role = Enums<"app_role">;

/** Miroir côté interface des politiques RLS (la base reste la seule garantie). */
export function permissions(roles: readonly Role[], writable: boolean) {
  const has = (...r: Role[]) => r.some((x) => roles.includes(x));
  const staff = has("admin", "dentist", "assistant");
  return {
    clinical: has("dentist"),
    clinicalWrite: has("dentist") && writable,
    medical: has("dentist", "assistant"),
    medicalWrite: has("dentist", "assistant") && writable,
    patientsWrite: staff && writable,
    agendaWrite: staff && writable,
    billingRead: roles.length > 0,
    billingWrite: staff && writable,
    reports: has("admin", "accountant"),
    settings: has("admin"),
    settingsWrite: has("admin") && writable,
    subscription: has("admin"),
    isDentist: has("dentist"),
  };
}

export type Permissions = ReturnType<typeof permissions>;

export function cabinetWritable(c: { subscription_status: string; trial_ends_at: string | null } | null | undefined, now = Date.now()) {
  if (!c) return false;
  if (c.subscription_status === "active" || c.subscription_status === "past_due") return true;
  if (c.subscription_status === "trialing") return !c.trial_ends_at || new Date(c.trial_ends_at).getTime() > now;
  return false;
}
