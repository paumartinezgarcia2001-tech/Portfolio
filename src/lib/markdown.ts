/**
 * Markdown mínimo y seguro para el texto de Info editado desde el panel (P2,
 * fase 6). Solo lo que usa Info (C12):
 *
 * - `## Titulillo` (también `#` o `###`) → `<h2>`;
 * - párrafos separados por una línea en blanco;
 * - enlaces `[texto](https://…)` (se abren en otra pestaña) o `[texto](/contact)`
 *   (internos, con el `base` de la compilación).
 *
 * Todo lo demás se escapa: no hay HTML en bruto, así que un texto guardado en
 * la base de datos no puede meter scripts en la web.
 */

export interface MarkdownOptions {
  /** Pone el `base` a las rutas internas (withBase). */
  resolveInternal?: (path: string) => string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type LinkKind = 'external' | 'internal';

function linkKind(href: string): LinkKind | null {
  if (/^https?:\/\/[^\s]+$/i.test(href)) return 'external';
  if (/^\/(?!\/)[^\s]*$/.test(href) || /^#[\w-]+$/.test(href)) return 'internal';
  return null;
}

/** Texto de una línea con enlaces → HTML escapado. */
export function renderInline(text: string, options: MarkdownOptions = {}): string {
  const pattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let html = '';
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const [whole, label, href] = match;
    const index = match.index ?? 0;
    html += escapeHtml(text.slice(last, index));
    const kind = linkKind(href!);
    if (!kind) {
      html += escapeHtml(whole);
    } else if (kind === 'external') {
      html += `<a href="${escapeHtml(href!)}" target="_blank" rel="noopener">${escapeHtml(label!)}</a>`;
    } else {
      const resolved = href!.startsWith('/') && options.resolveInternal ? options.resolveInternal(href!) : href!;
      html += `<a href="${escapeHtml(resolved)}">${escapeHtml(label!)}</a>`;
    }
    last = index + whole.length;
  }
  return html + escapeHtml(text.slice(last));
}

/** Markdown de Info → HTML (seguro para `set:html`). */
export function renderInfoMarkdown(markdown: string, options: MarkdownOptions = {}): string {
  const blocks = stripComments(markdown)
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const heading = /^#{1,3}\s+(.+)$/.exec(block);
      if (heading && !block.includes('\n')) return `<h2>${renderInline(heading[1]!.trim(), options)}</h2>`;
      const lines = block.split('\n').map((line) => line.trim());
      // Un titulillo seguido de texto sin línea en blanco: se separan.
      const first = /^#{1,3}\s+(.+)$/.exec(lines[0] ?? '');
      if (first) {
        const rest = lines.slice(1).join(' ');
        return `<h2>${renderInline(first[1]!.trim(), options)}</h2>\n<p>${renderInline(rest, options)}</p>`;
      }
      return `<p>${renderInline(lines.join(' '), options)}</p>`;
    })
    .join('\n');
}

function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Texto de src/content/info.md → Markdown sencillo para el editor del panel:
 * sin comentarios y con los `<a href="…">…</a>` pasados a `[…](…)`.
 */
export function infoSourceToMarkdown(source: string): string {
  return stripComments(source)
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => `[${label.trim()}](${href})`)
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
