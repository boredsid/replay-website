// src/lib/supabase-rest.ts
//
// Build-time PostgREST URLs, for code that reads Supabase without the SDK
// (see scripts/normalize-sponsor-logos.ts).
//
// The trimming is not defensive noise: the `PUBLIC_SUPABASE_URL` set on the
// Cloudflare Pages project has a trailing space, which a template literal
// happily embeds mid-URL ("…supabase.co /rest/v1/…") and `fetch` then rejects
// with "Failed to parse URL". `supabase-js` never noticed because it hands the
// value to `new URL()`, which strips surrounding whitespace.

/** `https://project.supabase.co` + `sponsors?select=id` → a fetchable URL. */
export function restUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return `${base}/rest/v1/${path.replace(/^\/+/, '')}`;
}
