import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const landing = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/landing' }),
  schema: z.object({
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
  }),
});

export const collections = { landing };
