// worker/src/apps-script.ts
import type { Env } from "./index";

export interface EmailPayload {
  template: "replay-registration" | "replay-preorder";
  to: string;
  subject: string;
  variables: Record<string, string | number>;
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sendEmail(env: Env, payload: EmailPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = await hmacSha256Hex(env.APPS_SCRIPT_SECRET, body);
  // Apps Script doPost cannot read custom request headers reliably,
  // so we also pass the signature as a query param. The GAS handler
  // verifies whichever it finds.
  const url = new URL(env.APPS_SCRIPT_URL);
  url.searchParams.set("X-Signature", signature);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signature,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Apps Script returned ${res.status}`);
  }
}
