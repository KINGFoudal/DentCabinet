"use client";

import type { ReactNode } from "react";
import { formatPhone, fullName } from "@/lib/format";
import type { Row } from "@/lib/local/db";
import { lineTotal } from "../lib/totals";
import type { Patient } from "../data";
import { useBilling } from "./common";
import { cn } from "@/components/ui/cn";

/** Styles d'impression (A4) communs aux devis, factures et reçus. */
export function PrintStyles() {
  return (
    <style>{`
      @media print {
        @page { size: A4; margin: 14mm; }
        html, body { background: #fff !important; }
        main { padding: 0 !important; }
        .print-doc { border: none !important; box-shadow: none !important; padding: 0 !important; max-width: none !important; color: #000; }
        .print-doc * { color: #000 !important; border-color: #999 !important; background: transparent !important; }
        .print-avoid-break { break-inside: avoid; }
      }
    `}</style>
  );
}

/** Feuille imprimable : en-tête du cabinet, titre du document et contenu. */
export function PrintSheet({
  cabinet,
  title,
  meta,
  watermark,
  children,
}: {
  cabinet: Row<"cabinets"> | null;
  title: string;
  meta: ReactNode;
  watermark?: string | null;
  children: ReactNode;
}) {
  return (
    <article className="print-doc relative mx-auto w-full max-w-3xl rounded-xl border border-border bg-surface p-4 text-sm sm:p-8">
      {watermark && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-warning">
          {watermark}
        </div>
      )}
      <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-lg font-semibold text-primary">{cabinet?.name ?? ""}</div>
          <div className="mt-1 space-y-0.5 text-xs text-muted">
            {cabinet?.address && <div>{cabinet.address}</div>}
            {cabinet?.city && <div>{cabinet.city}</div>}
            {cabinet?.phone && <div>{formatPhone(cabinet.phone)}</div>}
            {cabinet?.email && <div>{cabinet.email}</div>}
          </div>
        </div>
        <div className="sm:text-right">
          <div className="text-xl font-bold uppercase tracking-wide">{title}</div>
          <div className="mt-1 space-y-0.5 text-xs">{meta}</div>
        </div>
      </header>
      {children}
    </article>
  );
}

export function MetaLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <span className="text-muted">{label} : </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function PatientBlock({ patient }: { patient: Patient | undefined }) {
  const { t } = useBilling();
  if (!patient) return null;
  return (
    <section className="mt-4 rounded-lg border border-border p-3 print-avoid-break">
      <div className="text-xs uppercase text-muted">{t("billing.fields.patient")}</div>
      <div className="font-medium">{fullName(patient)}</div>
      <div className="text-xs text-muted">
        {[patient.file_number && `${t("billing.print.fileNumber")} ${patient.file_number}`, formatPhone(patient.phone), patient.address, patient.city]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </section>
  );
}

/** Colonnes secondaires : masquées sur téléphone, toujours imprimées. */
const wide = "hidden sm:table-cell print:table-cell";

type Line = { id: string; label: string; tooth: number | null; quantity: number; unit_price_gnf: number; deleted_at?: string | null };

/** Tableau des lignes d'un devis ou d'une facture, avec total. */
export function LinesTable({ lines, total, provisional, footer }: { lines: readonly Line[]; total: number; provisional: boolean; footer?: ReactNode }) {
  const { t, gnf } = useBilling();
  const live = lines.filter((l) => !l.deleted_at);
  return (
    <section className="mt-4">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted">
              <th className="py-2 pr-2 font-medium">{t("billing.fields.label")}</th>
              <th className={cn(wide, "px-2 py-2 text-center font-medium")}>{t("billing.fields.tooth")}</th>
              <th className={cn(wide, "px-2 py-2 text-right font-medium")}>{t("billing.fields.quantityShort")}</th>
              <th className={cn(wide, "px-2 py-2 text-right font-medium")}>{t("billing.fields.unitPrice")}</th>
              <th className="py-2 pl-2 text-right font-medium">{t("billing.fields.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {live.map((l) => (
              <tr key={l.id} className="border-b border-border">
                <td className="py-2 pr-2">
                  {l.label}
                  {/* Téléphone : dent, quantité et prix unitaire sous le libellé, pour que le montant reste visible. */}
                  <span className="block text-xs text-muted sm:hidden print:hidden">
                    {[l.tooth != null && `${t("billing.fields.tooth")} ${l.tooth}`, `${l.quantity} × ${gnf(l.unit_price_gnf)}`].filter(Boolean).join(" · ")}
                  </span>
                </td>
                <td className={cn(wide, "px-2 py-2 text-center")}>{l.tooth ?? ""}</td>
                <td className={cn(wide, "px-2 py-2 text-right")}>{l.quantity}</td>
                <td className={cn(wide, "whitespace-nowrap px-2 py-2 text-right")}>{gnf(l.unit_price_gnf)}</td>
                <td className="whitespace-nowrap py-2 pl-2 text-right">{gnf(lineTotal(l))}</td>
              </tr>
            ))}
            {live.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted">
                  {t("billing.lines.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-col items-end gap-1 print-avoid-break">
        <div className="flex w-full max-w-xs justify-between gap-4 text-base font-semibold">
          <span>{t("billing.fields.total")}</span>
          <span className="whitespace-nowrap">
            {gnf(total)}
            {provisional && <span className="ml-1 align-super text-xs font-normal italic text-warning">*</span>}
          </span>
        </div>
        {footer}
        {provisional && <div className="text-xs italic text-warning">* {t("billing.provisionalHint")}</div>}
      </div>
    </section>
  );
}

export function TotalRow({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "danger" | "success" }) {
  return (
    <div
      className={`flex w-full max-w-xs justify-between gap-4 ${strong ? "font-semibold" : ""} ${tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : ""}`}
    >
      <span>{label}</span>
      <span className="whitespace-nowrap">{value}</span>
    </div>
  );
}
