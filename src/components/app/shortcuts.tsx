"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Keyboard } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/components/ui/cn";

/** Vrai si la frappe vise un champ de saisie (on n'intercepte alors aucune touche). */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Vrai si une fenêtre modale est ouverte (les raccourcis de page sont alors suspendus). */
function dialogOpen() {
  return !!document.querySelector("dialog[open]");
}

/**
 * Raccourcis clavier simples (une touche, sans Ctrl/Alt/Cmd), ignorés pendant la saisie
 * et quand une fenêtre est ouverte. `keys` : touche (KeyboardEvent.key) -> action.
 */
export function useShortcuts(keys: Record<string, () => void>, enabled = true) {
  const ref = useRef(keys);
  useEffect(() => {
    ref.current = keys;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTyping(e.target) || dialogOpen()) return;
      const action = ref.current[e.key] ?? ref.current[e.key.toLowerCase()];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** Attribut à poser sur le champ de recherche principal d'une page (touche « / »). */
export const SEARCH_ATTR = "data-shortcut-search";

const HELP: { keys: string[]; label: string }[] = [
  { keys: ["/"], label: "shortcuts.search" },
  { keys: ["?"], label: "shortcuts.help" },
  { keys: ["n"], label: "shortcuts.newAppointment" },
  { keys: ["t"], label: "shortcuts.today" },
  { keys: ["←", "→"], label: "shortcuts.prevNext" },
  { keys: ["p"], label: "shortcuts.newPatient" },
  { keys: ["Entrée"], label: "shortcuts.enterSave" },
  { keys: ["Échap"], label: "shortcuts.escape" },
];

/**
 * Raccourcis globaux de l'espace cabinet (« / » recherche, « ? » aide) et fenêtre d'aide.
 * Le bouton n'est affiché que sur grand écran (clavier).
 */
export function GlobalShortcuts() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useShortcuts({
    "/": () => {
      const el = document.querySelector<HTMLInputElement>(`[${SEARCH_ATTR}]`);
      if (el && el.offsetParent !== null) {
        el.focus();
        el.select();
      } else router.push("/app/patients");
    },
    "?": () => setOpen(true),
    // Nouveau patient depuis n'importe quelle page (la page patients ouvre la création rapide).
    ...(pathname === "/app/patients" ? {} : { p: () => router.push("/app/patients?nouveau=1") }),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("shortcuts.title")}
        title={`${t("shortcuts.title")} (?)`}
        className="hidden rounded-lg p-2 text-muted hover:text-primary lg:inline-flex"
      >
        <Keyboard className="size-4" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("shortcuts.title")} size="sm">
        <p className="mb-3 text-sm text-muted">{t("shortcuts.intro")}</p>
        <ul className="flex flex-col gap-2 text-sm">
          {HELP.map((h) => (
            <li key={h.label} className="flex items-center justify-between gap-3">
              <span>{t(h.label)}</span>
              <span className="flex shrink-0 gap-1">
                {h.keys.map((k) => (
                  <kbd key={k} className={cn("rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs")}>
                    {k === "Entrée" ? t("shortcuts.keyEnter") : k === "Échap" ? t("shortcuts.keyEscape") : k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
