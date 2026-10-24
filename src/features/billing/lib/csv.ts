/**
 * Export CSV compatible Excel (version française) : BOM UTF-8, séparateur « ; », fins de ligne CRLF.
 * Les montants sont écrits en entiers sans séparateur de milliers pour rester numériques dans Excel.
 */

export type Cell = string | number | null | undefined;

export const CSV_BOM = "﻿";
export const CSV_SEPARATOR = ";";

export function csvCell(value: Cell): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = value;
  // Évite qu'Excel interprète une saisie comme une formule (injection CSV).
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(CSV_SEPARATOR));
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

/** Déclenche le téléchargement d'un fichier CSV dans le navigateur. */
export function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
