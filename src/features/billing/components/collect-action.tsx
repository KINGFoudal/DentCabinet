"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import { fullName } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type { InvoiceView } from "../data";
import { useBilling } from "./common";
import { PaymentDialog } from "./payment-dialog";

/** Facture qu'on peut encaisser au comptoir depuis une liste (émise, reste à payer). */
export function collectable(v: InvoiceView) {
  return (v.figures.status === "issued" || v.figures.status === "partially_paid") && v.figures.balance > 0;
}

/** Action rapide « Encaisser » d'une liste de factures : une seule fenêtre pour toute la liste. */
export function useCollectAction() {
  const { t, canWrite } = useBilling();
  const [target, setTarget] = useState<InvoiceView | null>(null);

  function button(v: InvoiceView) {
    if (!canWrite || !collectable(v)) return null;
    return (
      <Button
        size="sm"
        className="shrink-0"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setTarget(v);
        }}
        aria-label={`${t("billing.actions.recordPayment")} ${v.invoice.number ?? ""}`.trim()}
      >
        <Wallet className="size-4" />
        {t("billing.actions.recordPayment")}
      </Button>
    );
  }

  const dialog = target ? (
    <PaymentDialog
      key={target.invoice.id}
      open
      onClose={() => setTarget(null)}
      invoiceId={target.invoice.id}
      balance={target.figures.balance}
      title={`${t("billing.payment.title")}${target.patient ? ` · ${fullName(target.patient)}` : ""}`}
    />
  ) : null;

  return { button, dialog };
}
