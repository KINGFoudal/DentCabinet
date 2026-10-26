import { describe, expect, it } from "vitest";
import { pollPaymentStatus } from "./poll";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("pollPaymentStatus", () => {
  it("interroge jusqu'à un état final", async () => {
    const answers = ["pending", "error", "pending", "succeeded"];
    let calls = 0;
    const r = await pollPaymentStatus({
      fetchFn: async (url) => {
        expect(url).toBe("/api/payments/status?id=tx%201");
        const a = answers[calls++];
        return a === "error" ? new Response("", { status: 500 }) : json(200, { status: a });
      },
      token: "t",
      id: "tx 1",
      sleep: async () => undefined,
    });
    expect(r).toBe("succeeded");
    expect(calls).toBe(4);
  });

  it("abandonne après 2 minutes", async () => {
    let clock = 0;
    let calls = 0;
    const r = await pollPaymentStatus({
      fetchFn: async () => {
        calls++;
        return json(200, { status: "pending" });
      },
      token: "t",
      id: "tx",
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
    expect(r).toBe("timeout");
    expect(calls).toBe(24);
  });

  it("s'arrête si annulé", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await pollPaymentStatus({ fetchFn: async () => json(200, { status: "pending" }), token: "t", id: "x", signal: ctrl.signal, sleep: async () => undefined });
    expect(r).toBe("aborted");
  });

  it("interroge tout de suite en reprise", async () => {
    const slept: number[] = [];
    const r = await pollPaymentStatus({
      fetchFn: async () => json(200, { status: "failed" }),
      token: async () => "t",
      id: "x",
      immediate: true,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(r).toBe("failed");
    expect(slept).toEqual([]);
  });
});
