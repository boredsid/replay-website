import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import mdx from "@astrojs/mdx";
import tailwindcss from "@tailwindcss/vite";
import { normalizeSponsorLogos } from "./scripts/normalize-sponsor-logos.ts";

/**
 * Cache-busting stamp for the generated link-preview card, exposed to pages as
 * `import.meta.env.PUBLIC_LINK_PREVIEW_VERSION`.
 *
 * `/link-preview.png` is redrawn on every build but keeps the same path, and
 * `public/_headers` caches `/*.png` for a week. Without a changing URL the old
 * card survives in browsers, at the Cloudflare edge, and in every social
 * scraper that already fetched it — which is exactly how a REPLAY 2 card
 * outlived REPLAY 2. Appending this to the `og:image` URL makes each build
 * advertise an address nothing has cached yet.
 *
 * Deliberately a timestamp and NOT the commit SHA: the admin's rebuild action
 * redeploys the same commit with new edition data, which is precisely the case
 * that has to bust the cache. Set at module scope so Astro's env loader picks
 * it up, and so every page in a build stamps the same value.
 */
process.env.PUBLIC_LINK_PREVIEW_VERSION ||= Date.now().toString(36);

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
  // `/partner/` is only reachable through a link an admin sends; it has nothing
  // to say to a crawler.
  integrations: [sponsorLogos(), react(), mdx(), sitemap({ filter: (page) => !page.includes('/partner/') })],
  vite: { plugins: [tailwindcss()] },
});
