/** Horaires : {"1": [["08:00","12:00"],["14:00","18:00"]], ...} ; 1 = lundi ... 7 = dimanche. */
export type OpeningHours = Record<string, [string, string][]>;

export type PublicDentist = { id: string; name: string | null };
export type PublicAppointmentType = { id: string; name: string; duration_minutes: number };

/** Réponse de la RPC public_cabinet. */
export type PublicCabinet = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  logo_path: string | null;
  description: string | null;
  opening_hours: OpeningHours;
  online_booking_enabled: boolean;
  timezone: string;
  dentists: PublicDentist[];
  appointment_types: PublicAppointmentType[];
};

/** Réponse de la RPC portal_cabinets (un élément par cabinet où le patient est suivi). */
export type PortalCabinet = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  timezone: string;
  logo_path: string | null;
  public_page_enabled: boolean;
  online_booking_enabled: boolean;
  online_cancel_min_hours: number;
  patient_ids: string[];
  dentists: PublicDentist[];
  appointment_types: { id: string; name: string; color: string }[];
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Garde uniquement les intervalles valides « HH:MM ». */
export function parseOpeningHours(v: unknown): OpeningHours {
  const out: OpeningHours = {};
  if (!isObj(v)) return out;
  for (let d = 1; d <= 7; d++) {
    const list = v[String(d)];
    if (!Array.isArray(list)) continue;
    const ok = list.filter(
      (x): x is [string, string] =>
        Array.isArray(x) && x.length >= 2 && /^\d{2}:\d{2}/.test(String(x[0])) && /^\d{2}:\d{2}/.test(String(x[1])),
    );
    if (ok.length) out[String(d)] = ok.map(([a, b]) => [String(a).slice(0, 5), String(b).slice(0, 5)]);
  }
  return out;
}

export function parsePublicCabinet(v: unknown): PublicCabinet | null {
  if (!isObj(v) || typeof v.id !== "string" || typeof v.name !== "string") return null;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter(isObj) : []);
  return {
    id: v.id,
    name: v.name,
    slug: str(v.slug) ?? "",
    phone: str(v.phone),
    email: str(v.email),
    address: str(v.address),
    city: str(v.city),
    logo_path: str(v.logo_path),
    description: str(v.description),
    opening_hours: parseOpeningHours(v.opening_hours),
    online_booking_enabled: v.online_booking_enabled === true,
    timezone: str(v.timezone) ?? "Africa/Conakry",
    dentists: list(v.dentists).map((d) => ({ id: String(d.id), name: str(d.name) })),
    appointment_types: list(v.appointment_types).map((t) => ({
      id: String(t.id),
      name: String(t.name),
      duration_minutes: Number(t.duration_minutes) || 30,
    })),
  };
}

/** URL publique du logo (bucket « branding », public). */
export function logoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base}/storage/v1/object/public/branding/${path.split("/").map(encodeURIComponent).join("/")}` : null;
}
