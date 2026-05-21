import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import mdx from "@astrojs/mdx";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://replaycon.in",
  integrations: [react(), mdx(), sitemap()],
  vite: { plugins: [tailwindcss()] },
});
