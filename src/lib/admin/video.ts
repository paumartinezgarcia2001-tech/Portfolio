/**
 * Vídeo de Media desde el panel (P2, fase 6).
 *
 * `site_settings.video` guarda la misma forma que `MEDIA_VIDEO` de
 * src/config/media.ts. Si está vacío o no es válido, la web usa el del código.
 */
import { z } from 'astro/zod';
import type { MediaVideoConfig } from '../../config/media';
import { isMediaRef, parseRenditionsBlock } from './schemas';

const ref = z.string().refine(isMediaRef);

const rendition = z.object({
  hls: ref,
  mp4: ref,
  poster: z.object({ jpg: ref, avif: ref.optional() }),
  width: z.number().positive(),
  height: z.number().positive(),
});

const storedVideoSchema = rendition.extend({
  slug: z.string().min(1),
  title: z.string().min(1),
  audio: z.boolean(),
  mobile: rendition.optional().nullable(),
  focusX: z.number().min(0).max(1),
  focusY: z.number().min(0).max(1),
  fullSet: z
    .object({ href: z.string().regex(/^https:\/\//), label: z.string().min(1) })
    .nullable()
    .optional(),
});

/** Configuración guardada → configuración del vídeo, o `null` si no vale. */
export function parseStoredVideo(raw: unknown): MediaVideoConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = storedVideoSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { mobile, fullSet, ...rest } = parsed.data;
  return { ...rest, mobile: mobile ?? undefined, fullSet: fullSet ?? null };
}

export interface VideoFormInput {
  titulo: string;
  focoX: number;
  focoY: number;
  setCompleto: boolean;
  setUrl?: string | undefined;
  setTexto?: string | undefined;
  bloque?: string | undefined;
}

/** Formulario del panel + vídeo actual → vídeo que se guarda. */
export function buildVideoConfig(input: VideoFormInput, current: MediaVideoConfig): MediaVideoConfig {
  const block = input.bloque ? parseRenditionsBlock(input.bloque) : null;
  const base: MediaVideoConfig = block
    ? {
        ...current,
        slug: block.slug,
        audio: block.audio ?? current.audio,
        hls: block.hls,
        mp4: block.mp4,
        poster: block.poster,
        width: block.width,
        height: block.height,
        mobile: block.mobile ?? undefined,
      }
    : current;
  const round = (value: number) => Math.round(Math.min(100, Math.max(0, value)) * 10) / 1000;
  return {
    ...base,
    title: input.titulo,
    focusX: round(input.focoX),
    focusY: round(input.focoY),
    fullSet:
      input.setCompleto && input.setUrl
        ? { href: input.setUrl, label: input.setTexto || 'ver set completo' }
        : null,
  };
}

/** Configuración → JSON para `site_settings.video` (sin `undefined`). */
export function toStoredVideo(config: MediaVideoConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}
