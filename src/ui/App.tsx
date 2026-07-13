/** @jsxImportSource @opentui/react */

import { useBindings } from "@opentui/keymap/react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { CliRenderer, ScrollBoxRenderable } from "@opentui/core";
import { RGBA, SyntaxStyle, TextAttributes } from "@opentui/core";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyncManager, SyncSnapshot } from "../sync";
import type { Article, Feed, LayoutMode, Pane } from "../types";
import { clampIndex, formatDate, htmlToMarkdown, layoutMode, truncate, windowAround } from "../text";

const READER_SYNTAX = SyntaxStyle.fromStyles({
  "markup.heading": { fg: RGBA.fromHex("#d7ba7d"), bold: true },
  "markup.heading.1": { fg: RGBA.fromHex("#d7ba7d"), bold: true },
  "markup.heading.2": { fg: RGBA.fromHex("#d7ba7d"), bold: true },
  "markup.heading.3": { fg: RGBA.fromHex("#d7ba7d"), bold: true },
  "markup.list": { fg: RGBA.fromHex("#8b949e") },
  "markup.quote": { fg: RGBA.fromHex("#8b949e"), italic: true },
  "markup.raw": { fg: RGBA.fromHex("#a5d6ff") },
  "markup.raw.block": { fg: RGBA.fromHex("#a5d6ff") },
  "markup.link": { fg: RGBA.fromHex("#58a6ff"), underline: true },
  "markup.link.label": { fg: RGBA.fromHex("#58a6ff"), underline: true },
  "markup.link.url": { fg: RGBA.fromHex("#58a6ff"), underline: true },
  "markup.strong": { fg: RGBA.fromHex("#f0f6fc"), bold: true },
  "markup.italic": { fg: RGBA.fromHex("#d0d7de"), italic: true },
  default: { fg: RGBA.fromHex("#d0d7de") },
});

const READER_SCROLL_STEP = 3;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const UNREAD_GLYPH = "●";

type NavLevel = "sources" | "reading";
type ArticleView = "unread" | "all" | "starred";

const VIEW_ORDER: ArticleView[] = ["unread", "all", "starred"];
const VIEW_LABEL: Record<ArticleView, string> = { unread: "Unread", all: "All", starred: "Starred" };
const EMPTY_BY_VIEW: Record<ArticleView, string> = {
  unread: "No unread articles. Press v to switch views, r to sync.",
  all: "No articles in this feed. Press r to sync.",
  starred: "No starred articles yet. Press s on an article to star it.",
};

// Display row in the FeedPane. All three variants travel through the same
// windowing/clamp/index math in App; FeedPane renders each according to kind.
type SourceRow =
  | { kind: "all"; unreadCount: number }
  | { kind: "header"; label: string; unreadCount: number }
  | { kind: "feed"; id: string; title: string; unreadCount: number };

interface AppProps {
  sync: SyncManager;
  renderer: CliRenderer;
  initial: SyncSnapshot;
  syncOnStart: boolean;
}

export function App({ sync, renderer, initial, syncOnStart }: AppProps) {
  const { width, height } = useTerminalDimensions();
  const mode = layoutMode(width);
  const [snapshot, setSnapshot] = useState(initial);
  const [navLevel, setNavLevel] = useState<NavLevel>("reading");
  const [focusedPane, setFocusedPane] = useState<Pane>("articles");
  const [feedIndex, setFeedIndex] = useState(0);
  const [activeFeedId, setActiveFeedId] = useState<string | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [view, setView] = useState<ArticleView>("unread");
  // Articles read during this viewing that should stay visible (dimmed) until
  // the feed or view changes, so the cursor doesn't jump when you read one.
  const [stickyReadIds, setStickyReadIds] = useState<Set<string>>(() => new Set());
  const [filterMode, setFilterMode] = useState(false);
  const [filter, setFilter] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const readerScrollRef = useRef<ScrollBoxRenderable | null>(null);

  // Build the display rows once per snapshot, with category groups. Lifted out
  // of FeedPane so App can answer "what feed is at index N?" without re-walking
  // the feed list (and getting the wrong answer for indices that land on a
  // header row).
  const sourceRows = useMemo(() => buildSourceRows(snapshot.feeds), [snapshot.feeds]);
  const sourceRowsLength = sourceRows.length;
  // Header rows don't open a feed; only the "feed" variant does. Memoized so
  // the reference is stable across renders for callers that depend on it.
  const selectedSourceFeed = useMemo<Feed | null>(() => {
    const row = sourceRows[clampIndex(feedIndex, sourceRowsLength)];
    if (!row || row.kind !== "feed") return null;
    return snapshot.feeds.find((feed) => feed.id === row.id) ?? null;
  }, [sourceRows, snapshot.feeds, feedIndex, sourceRowsLength]);

  const activeFeed = activeFeedId ? (snapshot.feeds.find((feed) => feed.id === activeFeedId) ?? null) : null;
  const articleOptions = useMemo(
    () => ({
      feedId: activeFeedId,
      query: filter,
      unreadOnly: view === "unread",
      starredOnly: view === "starred",
      keepIds: [...stickyReadIds],
    }),
    [activeFeedId, filter, view, stickyReadIds],
  );

  const refreshFromCache = useCallback(() => {
    setSnapshot(sync.snapshot(articleOptions));
  }, [articleOptions, sync]);

  const runSync = useCallback(async () => {
    setBusy(true);
    setSnapshot(sync.snapshot(articleOptions));
    setSnapshot(await sync.sync(articleOptions, setSnapshot));
    setBusy(false);
  }, [articleOptions, sync]);

  useEffect(() => {
    refreshFromCache();
  }, [refreshFromCache]);

  useEffect(() => {
    if (syncOnStart) void runSync();
  }, []);

  // Advance the status-bar spinner only while a sync is in flight.
  useEffect(() => {
    if (!busy) {
      setSpinnerFrame(0);
      return;
    }
    const interval = setInterval(() => setSpinnerFrame((frame) => (frame + 1) % SPINNER_FRAMES.length), 90);
    return () => clearInterval(interval);
  }, [busy]);

  useEffect(() => {
    setFeedIndex((current) => clampIndex(current, sourceRowsLength));
  }, [sourceRowsLength]);

  // Keep the selection pinned to an article by id. When the list changes and the
  // selected article is gone (e.g. it dropped out of the feed on sync), fall back
  // to the first article rather than letting the cursor drift to a stale index.
  useEffect(() => {
    if (snapshot.articles.length === 0) {
      if (selectedArticleId !== null) setSelectedArticleId(null);
      return;
    }
    if (!snapshot.articles.some((article) => article.id === selectedArticleId)) {
      setSelectedArticleId(snapshot.articles[0].id);
    }
  }, [snapshot.articles, selectedArticleId]);

  const articleIndex = useMemo(() => {
    const found = snapshot.articles.findIndex((article) => article.id === selectedArticleId);
    return found >= 0 ? found : 0;
  }, [snapshot.articles, selectedArticleId]);
  const selectedArticle = snapshot.articles[articleIndex] ?? null;

  const enterReadingLevel = useCallback(() => {
    setActiveFeedId(selectedSourceFeed?.id ?? null);
    setNavLevel("reading");
    setFocusedPane("articles");
    setSelectedArticleId(null); // reconcile effect selects the first article of the new feed
    setStickyReadIds(new Set()); // fresh sticky-read set per feed
  }, [selectedSourceFeed?.id]);

  const openArticle = useCallback(() => {
    setFocusedPane("reader");
    if (selectedArticle && !selectedArticle.isRead) {
      const article = selectedArticle;
      // Adding to the sticky set changes articleOptions, which re-runs the
      // cache refresh effect. setRead writes to SQLite synchronously before its
      // first await, so that refresh already sees the new read state — no manual
      // refresh here, which would query with the pre-sticky options and briefly
      // drop the article, jumping the cursor.
      setStickyReadIds((prev) => new Set(prev).add(article.id));
      void sync.setRead(article, true);
    }
  }, [selectedArticle, sync]);

  const moveFocus = useCallback(
    (direction: -1 | 1) => {
      if (direction < 0) {
        setFocusedPane((current) => {
          if (current === "reader") return "articles";
          setNavLevel("sources");
          return "feeds";
        });
        return;
      }

      if (navLevel === "sources" || focusedPane === "feeds") {
        enterReadingLevel();
        return;
      }

      if (focusedPane === "articles") openArticle();
    },
    [enterReadingLevel, focusedPane, navLevel, openArticle],
  );

  const selectArticleAt = useCallback(
    (index: number) => {
      const target = snapshot.articles[clampIndex(index, snapshot.articles.length)];
      if (target) setSelectedArticleId(target.id);
    },
    [snapshot.articles],
  );

  const moveSelection = useCallback(
    (direction: -1 | 1) => {
      if (navLevel === "sources" || focusedPane === "feeds") {
        setFeedIndex((current) => clampIndex(current + direction, sourceRowsLength));
      } else if (focusedPane === "articles") {
        selectArticleAt(articleIndex + direction);
      } else if (focusedPane === "reader") {
        readerScrollRef.current?.scrollBy(direction * READER_SCROLL_STEP);
      }
    },
    [articleIndex, focusedPane, navLevel, selectArticleAt, sourceRowsLength],
  );

  const jumpSelection = useCallback(
    (target: "top" | "bottom") => {
      if (navLevel === "sources" || focusedPane === "feeds") {
        setFeedIndex(target === "top" ? 0 : Math.max(0, sourceRowsLength - 1));
      } else if (focusedPane === "articles") {
        selectArticleAt(target === "top" ? 0 : snapshot.articles.length - 1);
      } else if (focusedPane === "reader") {
        const scroll = readerScrollRef.current;
        if (scroll) scroll.scrollTo(target === "top" ? 0 : scroll.scrollHeight);
      }
    },
    [focusedPane, navLevel, selectArticleAt, snapshot.articles.length, sourceRowsLength],
  );

  const activate = useCallback(() => {
    if (navLevel === "sources" || focusedPane === "feeds") {
      enterReadingLevel();
    } else if (focusedPane === "articles") {
      openArticle();
    }
  }, [enterReadingLevel, focusedPane, navLevel, openArticle]);

  const cycleView = useCallback(() => {
    setView((current) => VIEW_ORDER[(VIEW_ORDER.indexOf(current) + 1) % VIEW_ORDER.length]);
    setStickyReadIds(new Set());
    setSelectedArticleId(null);
  }, []);

  const toggleRead = useCallback(async () => {
    if (!selectedArticle) return;
    const article = selectedArticle;
    const nextRead = !article.isRead;
    if (nextRead) {
      // Sticky-set change drives the refresh (see openArticle) and keeps the
      // just-read article in place instead of dropping it under the cursor.
      setStickyReadIds((prev) => new Set(prev).add(article.id));
      await sync.setRead(article, true);
    } else {
      await sync.setRead(article, false);
      refreshFromCache();
    }
  }, [refreshFromCache, selectedArticle, sync]);

  const toggleStarred = useCallback(async () => {
    if (!selectedArticle) return;
    await sync.setStarred(selectedArticle, !selectedArticle.isStarred);
    refreshFromCache();
  }, [refreshFromCache, selectedArticle, sync]);

  const openInBrowser = useCallback(() => {
    const url = selectedArticle?.url;
    if (url) openUrl(url);
  }, [selectedArticle?.url]);

  useBindings(
    () => ({
      enabled: !filterMode,
      commands: [
        { name: "quit", run: () => renderer.destroy() },
        { name: "focus-left", run: () => moveFocus(-1) },
        { name: "focus-right", run: () => moveFocus(1) },
        { name: "move-down", run: () => moveSelection(1) },
        { name: "move-up", run: () => moveSelection(-1) },
        { name: "jump-top", run: () => jumpSelection("top") },
        { name: "jump-bottom", run: () => jumpSelection("bottom") },
        { name: "activate", run: () => activate() },
        { name: "sync", run: () => void runSync() },
        { name: "toggle-read", run: () => void toggleRead() },
        { name: "toggle-starred", run: () => void toggleStarred() },
        { name: "cycle-view", run: () => cycleView() },
        { name: "open-browser", run: () => openInBrowser() },
        { name: "filter", run: () => setFilterMode(true) },
        { name: "help", run: () => setHelpOpen((open) => !open) },
        {
          name: "close-overlay",
          run: () => {
            setFilterMode(false);
            setHelpOpen(false);
          },
        },
      ],
      bindings: [
        { key: "q", cmd: "quit" },
        { key: "h", cmd: "focus-left" },
        { key: "l", cmd: "focus-right" },
        { key: "j", cmd: "move-down" },
        { key: "k", cmd: "move-up" },
        { key: "g", cmd: "jump-top" },
        { key: "G", cmd: "jump-bottom" },
        { key: "shift+g", cmd: "jump-bottom" },
        { key: "return", cmd: "activate" },
        { key: "r", cmd: "sync" },
        { key: "m", cmd: "toggle-read" },
        { key: "s", cmd: "toggle-starred" },
        { key: "v", cmd: "cycle-view" },
        { key: "o", cmd: "open-browser" },
        { key: "/", cmd: "filter" },
        { key: "?", cmd: "help" },
        { key: "escape", cmd: "close-overlay" },
      ],
    }),
    [activate, cycleView, filterMode, jumpSelection, moveFocus, moveSelection, openInBrowser, renderer, runSync, toggleRead, toggleStarred],
  );

  useKeyboard((key) => {
    if (!filterMode || key.ctrl || key.meta) return;

    if (key.name === "escape" || key.name === "return") {
      setFilterMode(false);
      return;
    }

    if (key.name === "backspace") {
      setFilter((current) => current.slice(0, -1));
      return;
    }

    if (key.sequence && key.sequence.length === 1 && key.sequence >= " ") {
      setFilter((current) => current + key.sequence);
    }
  });

  const statusSource = navLevel === "sources" ? selectedSourceFeed : activeFeed;

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#101418">
      <box flexGrow={1} width="100%" flexDirection="row" backgroundColor="#101418">
        {navLevel === "sources" ? (
          // Sources level: feed list, with the reader kept alongside in wide modes.
          <>
            <FeedPane
              mode={mode}
              focused
              rows={sourceRows}
              selectedIndex={feedIndex}
              activeFeedId={activeFeedId}
              height={height}
            />
            {mode !== "one" ? (
              <ReaderPane mode={mode} focused={false} article={selectedArticle} width={width} scrollRef={readerScrollRef} />
            ) : null}
          </>
        ) : (
          // Reading level: article list plus reader (one pane at a time when narrow).
          <>
            {readingPanesForMode(mode, focusedPane).includes("articles") ? (
              <ArticlePane
                mode={mode}
                focused={focusedPane === "articles"}
                articles={snapshot.articles}
                selectedIndex={articleIndex}
                height={height}
                sourceTitle={activeFeed?.title ?? `${VIEW_LABEL[view]}${view === "all" ? " Articles" : ""}`}
                view={view}
                terminalWidth={width}
              />
            ) : null}
            {readingPanesForMode(mode, focusedPane).includes("reader") ? (
              <ReaderPane
                mode={mode}
                focused={focusedPane === "reader"}
                article={selectedArticle}
                width={width}
                scrollRef={readerScrollRef}
              />
            ) : null}
          </>
        )}
      </box>
      {helpOpen ? <HelpOverlay /> : null}
      <StatusBar
        snapshot={snapshot}
        filter={filter}
        filterMode={filterMode}
        busy={busy}
        selectedFeed={statusSource}
        activeFeed={activeFeed}
        navLevel={navLevel}
        view={view}
        spinner={busy ? SPINNER_FRAMES[spinnerFrame] : ""}
      />
    </box>
  );
}

function readingPanesForMode(mode: LayoutMode, focusedPane: Pane): Pane[] {
  if (mode === "one") return [focusedPane === "reader" ? "reader" : "articles"];
  return ["articles", "reader"];
}

// Open a URL in the user's default browser. Best-effort across platforms; a
// missing opener just no-ops rather than crashing the TUI.
function openUrl(url: string): void {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    Bun.spawn([opener, ...args], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // No browser opener available (headless/test); ignore.
  }
}

// Walk the already-sorted feeds array, inserting a "header" row before each
// new group boundary. The "All Feeds" row sits at index 0; category groups
// follow in the same case-insensitive order listFeeds uses. Uncategorized
// feeds ("Feeds" group) appear right after "All Feeds" if present, then
// categorized groups. With zero feeds the result is just [All Feeds].
function buildSourceRows(feeds: Feed[]): SourceRow[] {
  const totalUnread = feeds.reduce((total, feed) => total + feed.unreadCount, 0);
  const rows: SourceRow[] = [{ kind: "all", unreadCount: totalUnread }];

  let currentGroup: string | null | undefined = undefined;
  for (const feed of feeds) {
    const label = feed.categoryLabel ?? null;
    if (label !== currentGroup) {
      // First uncategorized feed gets the "Feeds" header; subsequent
      // category transitions get a header with the category label.
      const headerLabel = label ?? "Feeds";
      rows.push({ kind: "header", label: headerLabel, unreadCount: feed.unreadCount });
      currentGroup = label;
    } else {
      // Add this feed's unread count to the running header total. The header
      // is the most recent header row in the list (not necessarily the very
      // last row, which is the previous feed row).
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];
        if (row && row.kind === "header") {
          row.unreadCount += feed.unreadCount;
          break;
        }
      }
    }
    rows.push({ kind: "feed", id: feed.id, title: feed.title, unreadCount: feed.unreadCount });
  }

  return rows;
}

function FeedPane({
  mode,
  focused,
  rows,
  selectedIndex,
  activeFeedId,
  height,
}: {
  mode: LayoutMode;
  focused: boolean;
  rows: SourceRow[];
  selectedIndex: number;
  activeFeedId: string | null;
  height: number;
}) {
  const visible = windowAround(rows, selectedIndex, Math.max(3, height - 5));
  const width = mode === "one" ? "100%" : mode === "three" ? 38 : 34;
  const labelWidth = mode === "one" ? 80 : 38;
  // "No feeds" means no subscriptions at all (the synthetic "All Feeds" row
  // sits alone before any categories are added).
  const hasNoFeeds = rows.length <= 1;

  return (
    <box width={width} height="100%" border borderColor={focused ? "#d7ba7d" : "#3a4450"} title="Sources" padding={1}>
      {hasNoFeeds ? <text fg="#8b949e">No feeds yet. Press r to sync.</text> : null}
      {hasNoFeeds ? null : visible.items.map((row, index) => {
        const absoluteIndex = visible.offset + index;
        const selected = absoluteIndex === selectedIndex;

        if (row.kind === "header") {
          return (
            <text key={`header-${row.label}`} fg="#8b949e" attributes={TextAttributes.BOLD}>
              {`${row.label}  (${row.unreadCount} unread)`}
            </text>
          );
        }

        if (row.kind === "all") {
          const countLabel = String(row.unreadCount).padStart(3, " ");
          const label = `${countLabel}   All Feeds`;
          return (
            <text
              key="all-unread"
              fg={selected ? "#101418" : row.unreadCount > 0 ? "#f0f6fc" : "#8b949e"}
              bg={selected ? "#d7ba7d" : undefined}
            >
              {truncate(label, labelWidth)}
            </text>
          );
        }

        const active = row.id === activeFeedId;
        const countLabel = row.unreadCount > 0 ? String(row.unreadCount).padStart(3, " ") : "   ";
        const label = `${countLabel} ${active ? "> " : "  "}${row.title}`;
        return (
          <text
            key={row.id}
            fg={selected ? "#101418" : row.unreadCount > 0 ? "#f0f6fc" : "#8b949e"}
            bg={selected ? "#d7ba7d" : undefined}
          >
            {truncate(label, labelWidth)}
          </text>
        );
      })}
    </box>
  );
}

function ArticlePane({
  mode,
  focused,
  articles,
  selectedIndex,
  height,
  sourceTitle,
  view,
  terminalWidth,
}: {
  mode: LayoutMode;
  focused: boolean;
  articles: Article[];
  selectedIndex: number;
  height: number;
  sourceTitle: string;
  view: ArticleView;
  terminalWidth: number;
}) {
  // 2 lines per article: title on line 1, attribution on line 2. window size
  // is in articles; rendered output is 2 * count.
  const window = windowAround(articles, selectedIndex, Math.max(2, Math.floor((height - 5) / 2)));
  const width = mode === "one" ? "100%" : mode === "three" ? 42 : 34;
  // Line budgets (after pane border + padding chrome). Marker (3) + space (1)
  // + title + space (1) + date (5) = 10 chars of overhead on line 1; title
  // truncate = lineBudget - 10. Line 2 = 2-char indent + feed + author, with
  // ` · ` separator (3 chars) when author present.
  const contentWidth = mode === "one" ? Math.max(40, terminalWidth - 4) : (width as number) - 4;
  const lineBudget = contentWidth;
  const titleMax = Math.max(8, lineBudget - 10);
  const metaMax = Math.max(8, lineBudget - 5);

  return (
    <box width={width} height="100%" border borderColor={focused ? "#d7ba7d" : "#3a4450"} title={sourceTitle} padding={1}>
      {window.items.length === 0 ? <text fg="#8b949e">{EMPTY_BY_VIEW[view]}</text> : null}
      {window.items.map((article, index) => {
        const absoluteIndex = window.offset + index;
        const selected = absoluteIndex === selectedIndex;
        const dim = article.isRead;
        const starMark = article.isStarred ? "*" : " ";
        const dotMark = dim ? " " : UNREAD_GLYPH;
        // Marker column is exactly 3 chars so title indentation lines up
        // whether the row is starred or not.
        const marker = `${starMark} ${dotMark}`;
        const date = formatDate(article.published);
        const title = truncate(article.title, titleMax);
        const line1 = date ? `${marker} ${title} ${date}` : `${marker} ${title}`.trimEnd();
        const attribution = article.author
          ? `${article.originTitle ?? ""}  ·  ${article.author}`.replace(/^  ·  /, "")
          : article.originTitle ?? "";
        const line2 = truncate(attribution, metaMax);

        // Cursor highlight overrides per-article dim/read color. Sticky-read
        // (read but in keepIds) still uses the dim color when not selected.
        const baseFg = selected ? "#101418" : dim ? "#8b949e" : "#f0f6fc";
        const baseBg = selected ? "#d7ba7d" : undefined;

        return (
          <box key={article.id} flexDirection="column">
            <text fg={baseFg} bg={baseBg}>
              {line1}
            </text>
            <text fg={selected ? "#101418" : "#8b949e"} bg={baseBg}>
              {line2}
            </text>
          </box>
        );
      })}
    </box>
  );
}

function ReaderPane({
  mode,
  focused,
  article,
  width,
  scrollRef,
}: {
  mode: LayoutMode;
  focused: boolean;
  article: Article | null;
  width: number;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
}) {
  const readerWidth = mode === "three" ? width - 42 : mode === "two" ? width - 34 : width;
  const maxTitle = Math.max(20, readerWidth - 8);
  const markdown = useMemo(() => (article ? htmlToMarkdown(article.content || article.summary) : ""), [article]);

  return (
    <box flexGrow={1} width="100%" height="100%" border borderColor={focused ? "#d7ba7d" : "#3a4450"} title="Reader" padding={1} flexDirection="column">
      {!article ? (
        <text fg="#8b949e">Select an article.</text>
      ) : (
        <>
          <box flexShrink={0} flexDirection="column">
            <text fg="#f0f6fc" attributes={TextAttributes.BOLD}>
              {truncate(article.title, maxTitle)}
            </text>
            <text fg="#8b949e">{truncate([article.originTitle, article.author, formatDate(article.published)].filter(Boolean).join("  ·  "), maxTitle)}</text>
            <text> </text>
          </box>
          {/* key remounts the scrollbox per article, resetting scroll to top. */}
          <scrollbox key={article.id} ref={scrollRef} flexGrow={1} style={{ rootOptions: { backgroundColor: "#101418" } }}>
            {markdown.length === 0 ? (
              <text fg="#8b949e">(empty article body)</text>
            ) : (
              <markdown content={markdown} syntaxStyle={READER_SYNTAX} style={{ width: "100%" }} />
            )}
          </scrollbox>
        </>
      )}
    </box>
  );
}

function StatusBar({
  snapshot,
  filter,
  filterMode,
  busy,
  selectedFeed,
  activeFeed,
  navLevel,
  view,
  spinner,
}: {
  snapshot: SyncSnapshot;
  filter: string;
  filterMode: boolean;
  busy: boolean;
  selectedFeed: Feed | null;
  activeFeed: Feed | null;
  navLevel: NavLevel;
  view: ArticleView;
  spinner: string;
}) {
  const unread = snapshot.feeds.reduce((total, feed) => total + feed.unreadCount, 0);
  const status = busy ? `${spinner} syncing` : snapshot.status;
  const left = `${status}  ·  ${VIEW_LABEL[view]}  ·  unread ${unread}`;
  const middle = selectedFeed
    ? `${navLevel === "sources" ? "selected" : "source"}: ${selectedFeed.title}`
    : `source: ${activeFeed?.title ?? VIEW_LABEL[view]}`;
  const queue = snapshot.pendingMutations > 0 ? `${snapshot.pendingMutations} queued | ` : "";
  const right = filterMode ? `/${filter}` : `${queue}${snapshot.message}`;

  return (
    <box height={1} width="100%" flexDirection="row" justifyContent="space-between" backgroundColor="#1f252b">
      <text fg="#f0f6fc">{truncate(left, 38)}</text>
      <text fg="#8b949e">{truncate(middle, 44)}</text>
      <text fg={snapshot.status === "error" || snapshot.status === "offline" ? "#ff7b72" : "#d7ba7d"}>
        {truncate(right || snapshot.message, 50)}
      </text>
    </box>
  );
}

function HelpOverlay() {
  return (
    <box
      position="absolute"
      top={2}
      left={4}
      width={66}
      height={16}
      border
      borderColor="#d7ba7d"
      backgroundColor="#101418"
      title="Keys"
      padding={1}
    >
      <text fg="#f0f6fc">j/k move   g/G top/bottom   enter/l open   h back</text>
      <text fg="#f0f6fc">in reader: j/k scroll   g/G jump to top/bottom</text>
      <text> </text>
      <text fg="#f0f6fc">m read/unread   s star   v cycle view   o open in browser</text>
      <text fg="#f0f6fc">r sync   / filter   ? help   escape close   q quit</text>
      <text> </text>
      <text fg="#8b949e">Opening an article marks it read; it stays listed (dimmed) until</text>
      <text fg="#8b949e">you leave the feed. v cycles Unread / All / Starred.</text>
    </box>
  );
}
