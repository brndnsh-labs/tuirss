/** @jsxImportSource @opentui/react */

import { type RefObject, useEffect, useMemo, useRef } from "react";
import {
  TextAttributes,
  type SelectOption,
  type SelectRenderable,
  type ScrollBoxRenderable,
} from "@opentui/core";
import type { Article, ArticleView, Feed, LayoutMode } from "../types";
import { formatDate, htmlToMarkdown, truncate } from "../text";
import {
  COLORS,
  PANE_WIDTHS,
  READER_SYNTAX,
  STAR_GLYPH,
  UNREAD_GLYPH,
} from "./theme";

// Display row in the Sources pane. The "all" pseudo-row sits at index 0; a
// "header" row is inert and inserted above each category group; "feed" rows
// are the real subscriptions. The cursor can rest on any of them, but only
// "feed" / "all" activate when Enter is pressed.
type SourceRow =
  | { kind: "all"; unreadCount: number }
  | { kind: "header"; label: string; unreadCount: number }
  | { kind: "feed"; id: string; title: string; unreadCount: number };

export const VIEW_LABEL: Record<ArticleView, string> = {
  unread: "Unread",
  all: "All",
  starred: "Starred",
};

const EMPTY_BY_VIEW: Record<ArticleView, string> = {
  unread: "No unread articles. Press v to switch views, r to sync.",
  all: "No articles in this feed. Press r to sync.",
  starred: "No starred articles yet. Press s on an article to star it.",
};

// Walk the already-sorted feeds array, inserting a "header" row before each
// new group boundary. The "All Feeds" row sits at index 0; category groups
// follow in the same case-insensitive order listFeeds uses. Uncategorized
// feeds ("Feeds" group) appear right after "All Feeds" if present, then
// categorized groups. With zero feeds the result is just [All Feeds].
export function buildSourceRows(feeds: Feed[]): SourceRow[] {
  const totalUnread = feeds.reduce((total, feed) => total + feed.unreadCount, 0);
  const rows: SourceRow[] = [{ kind: "all", unreadCount: totalUnread }];

  let currentGroup: string | null | undefined = undefined;
  let currentHeader: SourceRow | null = null;
  for (const feed of feeds) {
    const label = feed.categoryLabel ?? null;
    if (label !== currentGroup) {
      const headerLabel = label ?? "Feeds";
      currentHeader = { kind: "header", label: headerLabel, unreadCount: feed.unreadCount };
      rows.push(currentHeader);
      currentGroup = label;
    } else if (currentHeader) {
      currentHeader.unreadCount += feed.unreadCount;
    }
    rows.push({ kind: "feed", id: feed.id, title: feed.title, unreadCount: feed.unreadCount });
  }

  return rows;
}

const SELECT_BG = "#1a1f25";
const SELECT_TEXT = COLORS.text;
const SELECT_TEXT_DIM = COLORS.textDim;
const SELECT_SELECTED_BG = COLORS.accent;
const SELECT_SELECTED_TEXT = COLORS.textInverse;

export function Sources({
  rows,
  selectedIndex,
  onSelectedIndexChange,
  activeFeedId,
  focused,
  height,
  mode,
}: {
  rows: SourceRow[];
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  activeFeedId: string | null;
  focused: boolean;
  height: number;
  mode: LayoutMode;
}) {
  const options = useMemo(() => rows.map((row) => rowToOption(row, activeFeedId)), [rows, activeFeedId]);
  const width = PANE_WIDTHS[mode].feeds;
  const ref = useRef<SelectRenderable | null>(null);

  useEffect(() => {
    if (ref.current && ref.current.getSelectedIndex() !== selectedIndex) {
      ref.current.setSelectedIndex(selectedIndex);
    }
  }, [selectedIndex, options]);

  // Height inside the box: outer border (1) + padding (1) = 2 each side = 4
  // total chrome. Leave 1 row of breathing room.
  const innerHeight = Math.max(3, height - 5);

  return (
    <box width={width} height="100%" border borderColor={focused ? COLORS.borderFocused : COLORS.border} title="Sources" padding={1}>
      {rows.length <= 1 ? (
        <text fg={COLORS.textDim}>No feeds yet. Press r to sync.</text>
      ) : (
        <select
          ref={ref}
          options={options}
          height={innerHeight}
          showScrollIndicator
          backgroundColor={SELECT_BG}
          textColor={SELECT_TEXT}
          focusedTextColor={SELECT_TEXT}
          selectedBackgroundColor={SELECT_SELECTED_BG}
          selectedTextColor={SELECT_SELECTED_TEXT}
          descriptionColor={SELECT_TEXT_DIM}
          selectedDescriptionColor={SELECT_TEXT_DIM}
          onChange={(index) => onSelectedIndexChange(index)}
        />
      )}
    </box>
  );
}

function rowToOption(row: SourceRow, activeFeedId: string | null): SelectOption {
  if (row.kind === "header") {
    return { name: `\u2500 ${row.label}  (${row.unreadCount} unread)`, description: "", value: row };
  }
  if (row.kind === "all") {
    const countLabel = String(row.unreadCount).padStart(3, " ");
    return { name: `${countLabel}  All Feeds`, description: "", value: row };
  }
  const countLabel = row.unreadCount > 0 ? String(row.unreadCount).padStart(3, " ") : "   ";
  const activeMarker = row.id === activeFeedId ? "> " : "  ";
  return { name: `${countLabel}  ${activeMarker}${row.title}`, description: "", value: row };
}

export function ArticleList({
  articles,
  selectedArticleId,
  onSelect,
  focused,
  sourceTitle,
  view,
  height,
  mode,
}: {
  articles: Article[];
  selectedArticleId: string | null;
  onSelect: (id: string | null) => void;
  focused: boolean;
  sourceTitle: string;
  view: ArticleView;
  height: number;
  mode: LayoutMode;
}) {
  const options = useMemo(() => articles.map(articleToOption), [articles]);
  const indexFromId = useMemo(() => {
    const map = new Map<string, number>();
    articles.forEach((article, index) => map.set(article.id, index));
    return map;
  }, [articles]);

  const ref = useRef<SelectRenderable | null>(null);

  // Keep the select's selectedIndex in sync with the app's id-based selection.
  // Programmatic setSelectedIndex does not fire onChange, so this is a
  // one-way sync that won't loop with onChange → setState.
  useEffect(() => {
    if (!ref.current) return;
    const target = selectedArticleId ? indexFromId.get(selectedArticleId) ?? 0 : 0;
    if (ref.current.getSelectedIndex() !== target) {
      ref.current.setSelectedIndex(target);
    }
  }, [selectedArticleId, indexFromId]);

  const width = PANE_WIDTHS[mode].articles;
  const innerHeight = Math.max(2, height - 5);

  return (
    <box width={width} height="100%" border borderColor={focused ? COLORS.borderFocused : COLORS.border} title={sourceTitle} padding={1}>
      {articles.length === 0 ? (
        <text fg={COLORS.textDim}>{EMPTY_BY_VIEW[view]}</text>
      ) : (
        <select
          ref={ref}
          options={options}
          height={innerHeight}
          showScrollIndicator
          backgroundColor={SELECT_BG}
          textColor={SELECT_TEXT}
          focusedTextColor={SELECT_TEXT}
          selectedBackgroundColor={SELECT_SELECTED_BG}
          selectedTextColor={SELECT_SELECTED_TEXT}
          descriptionColor={SELECT_TEXT_DIM}
          selectedDescriptionColor={SELECT_TEXT_DIM}
          onChange={(index) => onSelect(articles[index]?.id ?? null)}
        />
      )}
    </box>
  );
}

function articleToOption(article: Article): SelectOption {
  const starMark = article.isStarred ? STAR_GLYPH : " ";
  const dotMark = article.isRead ? " " : UNREAD_GLYPH;
  // Marker column is exactly 3 chars so title indentation lines up whether
  // the row is starred or not.
  const marker = `${starMark} ${dotMark}`;
  const date = formatDate(article.published);
  const title = article.title;
  const line1 = date ? `${marker}  ${title}  ${date}` : `${marker}  ${title}`.trimEnd();
  const feedPart = article.originTitle ?? "";
  const authorPart = article.author ?? "";
  const description =
    feedPart && authorPart ? `${feedPart}  \u00B7  ${authorPart}` : feedPart || authorPart;
  return { name: line1, description };
}

export function Reader({
  article,
  focused,
  width,
  mode,
  scrollRef,
}: {
  article: Article | null;
  focused: boolean;
  width: number;
  mode: LayoutMode;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
}) {
  const readerWidth =
    mode === "three" ? Math.max(20, width - PANE_WIDTHS.three.feeds - PANE_WIDTHS.three.articles) : mode === "two" ? Math.max(20, width - PANE_WIDTHS.two.articles) : Math.max(20, width);
  const maxTitle = Math.max(20, readerWidth - 8);
  // Depend on the content fields, not the article object — App passes a new
  // reference on every refresh, which would defeat the memo otherwise.
  const markdown = useMemo(
    () => (article ? htmlToMarkdown(article.content || article.summary) : ""),
    [article?.id, article?.content, article?.summary],
  );

  return (
    <box flexGrow={1} width="100%" height="100%" border borderColor={focused ? COLORS.borderFocused : COLORS.border} title="Reader" padding={1} flexDirection="column">
      {!article ? (
        <text fg={COLORS.textDim}>Select an article.</text>
      ) : (
        <>
          <box flexShrink={0} flexDirection="column">
            <text fg={COLORS.text} attributes={TextAttributes.BOLD}>
              {truncate(article.title, maxTitle)}
            </text>
            <text fg={COLORS.textDim}>
              {truncate(
                [article.originTitle, article.author, formatDate(article.published)].filter(Boolean).join("  \u00B7  "),
                maxTitle,
              )}
            </text>
            <text> </text>
          </box>
          {/* key remounts the scrollbox per article, resetting scroll to top. */}
          <scrollbox
            key={article.id}
            ref={scrollRef}
            flexGrow={1}
            focused={focused}
            style={{ rootOptions: { backgroundColor: COLORS.bg } }}
          >
            {markdown.length === 0 ? (
              <text fg={COLORS.textDim}>(empty article body)</text>
            ) : (
              <markdown content={markdown} syntaxStyle={READER_SYNTAX} style={{ width: "100%" }} />
            )}
          </scrollbox>
        </>
      )}
    </box>
  );
}

export function FilterInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  return (
    <box height={1} width="100%" flexDirection="row" alignItems="center" backgroundColor={COLORS.filterRowBg} paddingLeft={1} paddingRight={1}>
      <text fg={COLORS.accent}>filter:</text>
      <text> </text>
      <input
        focused
        flexGrow={1}
        value={value}
        onInput={onChange}
        onSubmit={onSubmit}
        backgroundColor={COLORS.filterRowBg}
        textColor={COLORS.text}
        cursorColor={COLORS.accent}
      />
    </box>
  );
}
