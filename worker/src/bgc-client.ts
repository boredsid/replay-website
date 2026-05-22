// worker/src/bgc-client.ts
import type { Env } from "./index";

export type GuildTier = "initiate" | "adventurer" | "guildmaster";

export interface GuildStatus {
  tier: GuildTier | null;
  active: boolean;
}

export async function fetchGuildStatus(env: Env, phone: string): Promise<GuildStatus> {
  try {
    const res = await fetch(`${env.BGC_WORKER_URL}/api/guild-status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.REPLAY_TO_BGC_SECRET}`,
      },
      body: JSON.stringify({ phone }),
    });
    if (!res.ok) return { tier: null, active: false };
    const body = (await res.json()) as GuildStatus;
    return body;
  } catch {
    return { tier: null, active: false };
  }
}
