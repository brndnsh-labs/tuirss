export function htmlToText(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\/\s*(p|div|h[1-6]|li|blockquote|pre)\s*>/gi, "\n")
      .replace(/<\s*li[^>]*>/gi, "- ")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

/**
 * Convert feed-article HTML into markdown for the reader. This is deliberately
 * regex-based rather than a full parser: RSS/Atom bodies are block-structured
 * but messy, and the markdown renderable is forgiving. Anything we don't
 * recognize collapses to its text content.
 */
export function htmlToMarkdown(input: string): string {
  let html = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  // Fenced code blocks first, so inner markup is preserved verbatim.
  html = html.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_match, inner: string) => {
    const code = decodeHtmlEntities(inner.replace(/<[^>]+>/g, "")).replace(/\n+$/, "");
    return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
  });

  html = html.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, inner: string) => {
    return `\n\n${"#".repeat(Number(level))} ${inlineToMarkdown(inner).trim()}\n\n`;
  });

  html = html.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, inner: string) => {
    const text = inlineToMarkdown(inner).trim();
    const quoted = text
      .split("\n")
      .map((line) => `> ${line}`.trimEnd())
      .join("\n");
    return `\n\n${quoted}\n\n`;
  });

  html = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_match, inner: string) => {
    let index = 0;
    const items = inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_liMatch, li: string) => {
      index += 1;
      return `\n${index}. ${inlineToMarkdown(li).trim()}`;
    });
    return `\n\n${items.trim()}\n\n`;
  });

  html = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_match, inner: string) => {
    const items = inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_liMatch, li: string) => `\n- ${inlineToMarkdown(li).trim()}`);
    return `\n\n${items.trim()}\n\n`;
  });

  // Any list items left outside a <ul>/<ol>.
  html = html.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, li: string) => `\n- ${inlineToMarkdown(li).trim()}`);

  html = html
    .replace(/<\/(p|div|section|article|figure|figcaption)\s*>/gi, "\n\n")
    .replace(/<(p|div|section|article|figure|figcaption)[^>]*>/gi, "");

  html = inlineToMarkdown(html);

  return decodeHtmlEntities(html)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inlineToMarkdown(input: string): string {
  return input
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<a[^>]*\bhref=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, text: string) => {
      const label = stripTags(text).trim();
      if (!href || href.startsWith("javascript:")) return label;
      return label && label !== href ? `[${label}](${href})` : href;
    })
    .replace(/<img[^>]*\balt=["']([^"']+)["'][^>]*>/gi, (_match, alt: string) => `(image: ${alt.trim()})`)
    .replace(/<img[^>]*>/gi, "")
    .replace(/<\s*(strong|b)\s*>([\s\S]*?)<\/\s*(?:strong|b)\s*>/gi, (_match, _tag: string, inner: string) => `**${stripTags(inner).trim()}**`)
    .replace(/<\s*(em|i)\s*>([\s\S]*?)<\/\s*(?:em|i)\s*>/gi, (_match, _tag: string, inner: string) => `*${stripTags(inner).trim()}*`)
    .replace(/<\s*code\s*>([\s\S]*?)<\/\s*code\s*>/gi, (_match, inner: string) => `\`${stripTags(inner).trim()}\``)
    .replace(/<\s*hr\s*\/?\s*>/gi, "\n\n---\n\n")
    .replace(/<[^>]+>/g, "");
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, "");
}

export function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();

    if (lower.startsWith("#x")) {
      const value = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }

    if (lower.startsWith("#")) {
      const value = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }

    return named[lower] ?? match;
  });
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

export function windowAround<T>(items: T[], selectedIndex: number, size: number): { offset: number; items: T[] } {
  if (size <= 0) return { offset: 0, items: [] };

  const selected = clampIndex(selectedIndex, items.length);
  const half = Math.floor(size / 2);
  const offset = Math.max(0, Math.min(Math.max(0, selected - half), Math.max(0, items.length - size)));
  return { offset, items: items.slice(offset, offset + size) };
}

export function formatDate(timestamp: number | null): string {
  if (!timestamp) return "";
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function truncate(input: string, max: number): string {
  if (max <= 0) return "";
  if (input.length <= max) return input;
  if (max <= 3) return input.slice(0, max);
  return `${input.slice(0, max - 3)}...`;
}

export function layoutMode(width: number): "one" | "two" | "three" {
  if (width >= 120) return "three";
  if (width >= 80) return "two";
  return "one";
}
