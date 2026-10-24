import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { messages } from "./messages";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });
}

function has(tree: unknown, key: string) {
  return typeof key.split(".").reduce<unknown>((n, k) => (n && typeof n === "object" ? (n as Record<string, unknown>)[k] : undefined), tree) === "string";
}

describe("textes de la facturation", () => {
  it("toutes les clés utilisées existent en français et en anglais", () => {
    const used = new Set<string>();
    for (const f of files(path.dirname(new URL(import.meta.url).pathname))) {
      for (const m of readFileSync(f, "utf8").matchAll(/"(billing\.[A-Za-z0-9_.]+)"/g)) used.add(m[1]);
    }
    // Clés construites dynamiquement.
    for (const s of ["draft", "issued", "partially_paid", "paid", "cancelled"]) used.add(`billing.invoiceStatus.${s}`);
    for (const s of ["draft", "sent", "accepted", "refused", "expired"]) used.add(`billing.quoteStatus.${s}`);
    for (const s of ["cash", "orange_money", "mtn_momo", "transfer", "other"]) used.add(`billing.method.${s}`);
    for (const s of ["succeeded", "failed", "expired"]) used.add(`billing.mobile.${s}`);
    for (const s of ["paid", "partial", "overdue", "upcoming"]) used.add(`billing.installments.state.${s}`);
    const missing = [...used].filter((k) => !has(messages.fr, k) || !has(messages.en, k));
    expect(missing).toEqual([]);
  });
});
