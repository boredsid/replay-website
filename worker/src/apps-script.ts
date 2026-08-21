// worker/src/apps-script.ts
import type { Env } from "./index";

export interface EmailPayload {
  template: "replay-registration" | "replay-preorder" | "replay-partner";
  to: string;
  subject: string;
  variables: Record<string, string | number>;
}

interface AppsScriptResponse {
  ok?: boolean;
  error?: string;
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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
  // Apps Script may decode non-ASCII request text differently before exposing
  // e.postData.contents. Sign an ASCII-only envelope so names and subjects with
  // punctuation or non-Latin characters cannot invalidate the HMAC.
  const body = JSON.stringify({ payload_base64: base64Utf8(JSON.stringify(payload)) });
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
  const responseText = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Apps Script returned ${res.status}`);
  }

  let result: AppsScriptResponse | null = null;
  try {
    result = JSON.parse(responseText) as AppsScriptResponse;
  } catch {
    throw new Error("Apps Script returned an invalid response");
  }

  if (result?.ok !== true) {
    throw new Error(`Apps Script rejected email: ${result?.error || "unknown error"}`);
  }
}
