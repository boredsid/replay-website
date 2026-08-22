import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import mdx from "@astrojs/mdx";
import tailwindcss from "@tailwindcss/vite";
import { normalizeSponsorLogos } from "./scripts/normalize-sponsor-logos.ts";

/**
 * Rebuild `src/generated/sponsor-logos/` before Vite resolves the glob that
 * reads it.
 *
 * This deliberately hangs off the Astro lifecycle rather than an npm
 * `prebuild` hook: Cloudflare Pages invokes whatever build command its project
 * settings name, and a bare `astro build` would skip an npm hook entirely.
 * `partner-logos.ts` would then quietly fall back to un-normalised artwork —
 * a green build that silently ships the wrong thing. Running here means the
 * host's choice of command cannot matter.
 */
function sponsorLogos() {
  return {
    name: "sponsor-logos-normalize",
    hooks: {
      "astro:config:setup": async () => {
        await normalizeSponsorLogos();
      },
    },
  };
}

export default defineConfig({
  site: "https://replaycon.in",
  integrations: [sponsorLogos(), react(), mdx(), sitemap()],
  vite: { plugins: [tailwindcss()] },
});
