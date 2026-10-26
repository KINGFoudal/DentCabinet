import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Cible interne du proxy (src/proxy.ts) pour un slug inconnu : page statique qui répond 404.
// Le nom contient une majuscule, interdite dans un slug : aucun cabinet ne peut l'occuper.
export const metadata: Metadata = { title: "Cabinet introuvable", robots: { index: false } };

export default function UnknownCabinetPage() {
  notFound();
}
