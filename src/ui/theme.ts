import { RGBA, SyntaxStyle } from "@opentui/core";

export const COLORS = {
  bg: "#101418",
  statusBarBg: "#1f252b",
  surface: "#1a1f25",
  border: "#3a4450",
  borderFocused: "#d7ba7d",
  text: "#f0f6fc",
  textDim: "#8b949e",
  textInverse: "#101418",
  accent: "#d7ba7d",
  danger: "#ff7b72",
  readerLink: "#58a6ff",
  readerCode: "#a5d6ff",
  readerBody: "#d0d7de",
} as const;

export const READER_SYNTAX = SyntaxStyle.fromStyles({
  "markup.heading": { fg: RGBA.fromHex(COLORS.accent), bold: true },
  "markup.heading.1": { fg: RGBA.fromHex(COLORS.accent), bold: true },
  "markup.heading.2": { fg: RGBA.fromHex(COLORS.accent), bold: true },
  "markup.heading.3": { fg: RGBA.fromHex(COLORS.accent), bold: true },
  "markup.list": { fg: RGBA.fromHex(COLORS.textDim) },
  "markup.quote": { fg: RGBA.fromHex(COLORS.textDim), italic: true },
  "markup.raw": { fg: RGBA.fromHex(COLORS.readerCode) },
  "markup.raw.block": { fg: RGBA.fromHex(COLORS.readerCode) },
  "markup.link": { fg: RGBA.fromHex(COLORS.readerLink), underline: true },
  "markup.link.label": { fg: RGBA.fromHex(COLORS.readerLink), underline: true },
  "markup.link.url": { fg: RGBA.fromHex(COLORS.readerLink), underline: true },
  "markup.strong": { fg: RGBA.fromHex(COLORS.text), bold: true },
  "markup.italic": { fg: RGBA.fromHex(COLORS.readerBody), italic: true },
  default: { fg: RGBA.fromHex(COLORS.readerBody) },
});

export const UNREAD_GLYPH = "\u25CF";
export const STAR_GLYPH = "*";
export const SPINNER_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];

export const PANE_WIDTHS = {
  one: { feeds: "100%", articles: "100%", reader: "100%" },
  two: { feeds: 34, articles: 34, reader: "auto" },
  three: { feeds: 38, articles: 42, reader: "auto" },
} as const;
