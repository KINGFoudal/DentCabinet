import type { Role } from "@/lib/permissions";

export const ALL_ROLES: Role[] = ["admin", "dentist", "assistant", "accountant"];

type MemberLike = { id: string; roles: readonly string[]; active: boolean; deleted_at: string | null };

const counts = (m: MemberLike) => m.active && !m.deleted_at;

export function activeDentists(members: readonly MemberLike[]) {
  return members.filter((m) => counts(m) && m.roles.includes("dentist")).length;
}

/** Nombre de dentistes actifs si `edited` remplace le membre de même id (ou s'ajoute). */
export function dentistsAfter(members: readonly MemberLike[], edited: MemberLike) {
  const others = members.filter((m) => m.id !== edited.id);
  return activeDentists([...others, edited]);
}

/** Vrai si la modification retire le dernier administrateur actif. */
export function removesLastAdmin(members: readonly MemberLike[], edited: MemberLike) {
  const before = members.find((m) => m.id === edited.id);
  if (!before || !counts(before) || !before.roles.includes("admin")) return false;
  if (counts(edited) && edited.roles.includes("admin")) return false;
  return !members.some((m) => m.id !== edited.id && counts(m) && m.roles.includes("admin"));
}
