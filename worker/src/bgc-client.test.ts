import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchGuildStatus } from "./bgc-client";

const env = {
  BGC_WORKER_URL: "https://api.boardgamecompany.in",
  REPLAY_TO_BGC_SECRET: "test-secret",
} as any;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchGuildStatus", () => {
  it("posts phone with bearer token and returns parsed response", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ tier: "adventurer", active: true }), { status: 200 })
    );

    const result = await fetchGuildStatus(env, "9999999999");

    expect(result).toEqual({ tier: "adventurer", active: true });
    expect(spy).toHaveBeenCalledWith(
      "https://api.boardgamecompany.in/api/guild-status",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-secret",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ phone: "9999999999" }),
      })
    );
  });

  it("returns {tier:null, active:false} when bgc responds non-200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    const result = await fetchGuildStatus(env, "9999999999");
    expect(result).toEqual({ tier: null, active: false });
  });
});
