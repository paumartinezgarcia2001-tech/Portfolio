import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Textos de página en Markdown. Por ahora solo `src/content/info.md` (C12),
 * el texto de Info por defecto (el panel puede sustituirlo).
 */
const pages = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content' }),
  schema: z.object({
    title: z.string(),
  }),
});

export const collections = { pages };
