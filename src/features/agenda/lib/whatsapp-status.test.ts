import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { extractStatuses, shouldApplyStatus, verifyMetaSignature } from "../../../../supabase/functions/_shared/whatsapp-status";

describe("webhook WhatsApp (statuts)", () => {
  it("extrait les statuts de distribution", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                statuses: [
                  { id: "wamid.1", status: "delivered" },
                  { id: "wamid.2", status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] },
                  { id: "wamid.3", status: "deleted" },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(extractStatuses(payload)).toEqual([
      { id: "wamid.1", status: "delivered", error: null },
      { id: "wamid.2", status: "failed", error: "131026 Message undeliverable" },
    ]);
    expect(extractStatuses({})).toEqual([]);
  });

  it("un statut ne recule jamais", () => {
    expect(shouldApplyStatus("sent", "delivered")).toBe(true);
    expect(shouldApplyStatus("read", "delivered")).toBe(false);
    expect(shouldApplyStatus("delivered", "failed")).toBe(false);
    expect(shouldApplyStatus("sent", "failed")).toBe(true);
  });

  it("vérifie X-Hub-Signature-256", async () => {
    const body = '{"entry":[]}';
    const good = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
    expect(await verifyMetaSignature(body, good, "app-secret")).toBe(true);
    expect(await verifyMetaSignature(body + " ", good, "app-secret")).toBe(false);
    expect(await verifyMetaSignature(body, null, "app-secret")).toBe(false);
  });
});
