import { messages as common } from "./common";
import { messages as patients } from "@/features/patients/messages";
import { messages as agenda } from "@/features/agenda/messages";
import { messages as billing } from "@/features/billing/messages";
import { messages as portal } from "@/features/portal/messages";
import { messages as subscription } from "@/features/subscription/messages";
import { messages as settings } from "@/features/settings/messages";
import { messages as admin } from "@/features/admin/messages";

export type Locale = "fr" | "en";
export const LOCALES: Locale[] = ["fr", "en"];

type Tree = { readonly [key: string]: string | Tree };

const sources = [common, patients, agenda, billing, portal, subscription, settings, admin];

function merge(locale: Locale): Tree {
  return Object.assign({}, ...sources.map((s) => s[locale] as Tree));
}

export const dictionaries: Record<Locale, Tree> = { fr: merge("fr"), en: merge("en") };

/** Traduit une clé « namespace.cle » ; remplace {var} par vars.var. Repli sur le français. */
export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const lookup = (tree: Tree) =>
    key.split(".").reduce<string | Tree | undefined>((node, part) => (typeof node === "object" ? node[part] : undefined), tree);
  let value = lookup(dictionaries[locale]);
  if (typeof value !== "string") value = lookup(dictionaries.fr);
  if (typeof value !== "string") return key;
  return vars ? value.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`)) : value;
}
