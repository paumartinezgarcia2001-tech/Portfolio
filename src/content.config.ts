import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Textos de página en Markdown. Por ahora solo `src/content/info.md` (C12).
 * En la fase 6 (P2) Info podría pasar a editarse desde el panel.
 */
const pages = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content' }),
  schema: z.object({
    title: z.string(),
    provisional: z.boolean().default(false),
  }),
});

export const collections = { pages };
