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
