import { ageFrom } from "@/lib/format";

type SearchablePatient = {
  first_name: string;
  last_name: string;
  file_number?: string | null;
  phone?: string | null;
};

/** Normalise pour la recherche : minuscules, sans accents, espaces réduits. */
export function searchKey(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Vrai si le patient correspond à la recherche :
 * chaque mot doit apparaître dans le nom, le prénom ou le n° de dossier (sans accents),
 * ou bien les chiffres saisis (3 au moins) apparaissent dans le téléphone.
 */
export function matchesPatient(p: SearchablePatient, query: string) {
  const q = searchKey(query);
  if (!q) return true;
  const hay = searchKey(`${p.first_name} ${p.last_name} ${p.file_number ?? ""}`);
  if (q.split(" ").every((token) => hay.includes(token))) return true;
  const digits = query.replace(/\D/g, "");
  if (digits.length < 3) return false;
  const phone = (p.phone ?? "").replace(/\D/g, "");
  // « 620 12 34 56 » ou « 0620… » doivent retrouver « +224620123456 ».
  return phone.includes(digits) || phone.includes(digits.replace(/^0+/, "")) || (p.file_number ?? "").includes(digits);
}

export type PatientSort = "name" | "fileNumber" | "recent" | "age";

type SortablePatient = SearchablePatient & { created_at: string; birth_date?: string | null };

function compareName(a: SearchablePatient, b: SearchablePatient) {
  return (
    searchKey(a.last_name).localeCompare(searchKey(b.last_name)) || searchKey(a.first_name).localeCompare(searchKey(b.first_name))
  );
}

/** Trie une copie de la liste. Les patients sans valeur (n° provisoire, âge inconnu) passent en dernier. */
export function sortPatients<T extends SortablePatient>(list: readonly T[], sort: PatientSort, now = new Date()): T[] {
  const out = [...list];
  switch (sort) {
    case "name":
      return out.sort(compareName);
    case "recent":
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at) || compareName(a, b));
    case "fileNumber":
      return out.sort((a, b) => {
        if (!a.file_number && !b.file_number) return compareName(a, b);
        if (!a.file_number) return 1;
        if (!b.file_number) return -1;
        return a.file_number.localeCompare(b.file_number, undefined, { numeric: true });
      });
    case "age":
      return out.sort((a, b) => {
        const x = ageFrom(a.birth_date, now);
        const y = ageFrom(b.birth_date, now);
        if (x == null && y == null) return compareName(a, b);
        if (x == null) return 1;
        if (y == null) return -1;
        return x - y || compareName(a, b);
      });
  }
}

export type PatientFilter = "all" | "female" | "male" | "withAlerts" | "provisional" | "archived";

/** Filtre de la liste. `alerts` : identifiants des patients ayant au moins une alerte médicale. */
export function filterPatient(
  p: { id: string; sex?: string | null; file_number?: string | null; deleted_at?: string | null },
  filter: PatientFilter,
  alerts: ReadonlySet<string>,
) {
  if (filter === "archived") return !!p.deleted_at;
  if (p.deleted_at) return false;
  switch (filter) {
    case "all":
      return true;
    case "female":
      return p.sex === "female";
    case "male":
      return p.sex === "male";
    case "withAlerts":
      return alerts.has(p.id);
    case "provisional":
      return !p.file_number;
  }
}
