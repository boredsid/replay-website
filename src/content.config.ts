import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const landing = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/landing' }),
  schema: z.object({
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    photo: z.string().optional(),
  }),
});

export const collections = { landing };
