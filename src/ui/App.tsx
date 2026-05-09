/** @jsxImportSource @opentui/react */

import { useBindings } from "@opentui/keymap/react";
import { useKeyboard, useTerminalDimensions, useTimeline } from "@opentui/react";
import type { CliRenderer } from "@opentui/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyncManager, SyncSnapshot } from "../sync";
import type { Article, Feed, LayoutMode, Pane } from "../types";
import { clampIndex, formatDate, htmlToText, layoutMode, truncate, windowAround } from "../text";

type NavLevel = "sources" | "reading";

interface AppProps {
  sync: SyncManager;
  renderer: CliRenderer;
  initial: SyncSnapshot;
  syncOnStart: boolean;
}

export function App({ sync, renderer, initial, syncOnStart }: AppProps) {
  const { width, height } = useTerminalDimensions();
  const mode = layoutMode(width);
  const slideTimeline = useTimeline({ duration: 180, autoplay: false });
  const [snapshot, setSnapshot] = useState(initial);
  const [navLevel, setNavLevel] = useState<NavLevel>("reading");
  const [focusedPane, setFocusedPane] = useState<Pane>("articles");
  const [feedIndex, setFeedIndex] = useState(0);
  const [activeFeedId, setActiveFeedId] = useState<string | null>(null);
  const [articleIndex, setArticleIndex] = useState(0);
  const [filterMode, setFilterMode] = useState(false);
  const [filter, setFilter] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contentOffset, setContentOffset] = useState(0);
  const contentOffsetRef = useRef(0);

  const selectedSourceFeed = feedIndex === 0 ? null : (snapshot.feeds[clampIndex(feedIndex - 1, snapshot.feeds.length)] ?? null);
  const activeFeed = activeFeedId ? (snapshot.feeds.find((feed) => feed.id === activeFeedId) ?? null) : null;
  const articleOptions = useMemo(
    () => ({
      feedId: activeFeedId,
      query: filter,
      unreadOnly: true,
    }),
    [activeFeedId, filter],
  );

  const refreshFromCache = useCallback(() => {
    setSnapshot(sync.snapshot(articleOptions));
  }, [articleOptions, sync]);

  const runSync = useCallback(async () => {
    setBusy(true);
    setSnapshot(sync.snapshot(articleOptions));
    setSnapshot(await sync.sync(articleOptions));
    setBusy(false);
  }, [articleOptions, sync]);

  useEffect(() => {
    refreshFromCache();
  }, [refreshFromCache]);

  useEffect(() => {
    if (syncOnStart) void runSync();
  }, []);

  useEffect(() => {
    setFeedIndex((current) => clampIndex(current, snapshot.feeds.length + 1));
    setArticleIndex((current) => clampIndex(current, snapshot.articles.length));
  }, [snapshot.feeds.length, snapshot.articles.length]);

  useEffect(() => {
    const target = navLevel === "sources" && mode !== "one" ? width : 0;
    slideTimeline.resetItems();
    slideTimeline.add(
      { x: contentOffsetRef.current },
      {
        x: target,
        duration: 180,
        ease: "outCirc",
        onUpdate: (animation) => {
          const next = Math.round(animation.targets[0].x);
          contentOffsetRef.current = next;
          setContentOffset(next);
        },
        onComplete: () => {
          contentOffsetRef.current = target;
          setContentOffset(target);
        },
      },
    );
    slideTimeline.restart();
  }, [mode, navLevel, slideTimeline, width]);

  const selectedArticle = snapshot.articles[clampIndex(articleIndex, snapshot.articles.length)] ?? null;

  const enterReadingLevel = useCallback(() => {
    setActiveFeedId(selectedSourceFeed?.id ?? null);
    setNavLevel("reading");
    setFocusedPane("articles");
    setArticleIndex(0);
  }, [selectedSourceFeed?.id]);

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

      setFocusedPane("reader");
    },
    [enterReadingLevel, focusedPane, navLevel],
  );

  const moveSelection = useCallback(
    (direction: -1 | 1) => {
      if (navLevel === "sources" || focusedPane === "feeds") {
        setFeedIndex((current) => clampIndex(current + direction, snapshot.feeds.length + 1));
        setArticleIndex(0);
      } else if (focusedPane === "articles") {
        setArticleIndex((current) => clampIndex(current + direction, snapshot.articles.length));
      }
    },
    [focusedPane, navLevel, snapshot.articles.length, snapshot.feeds.length],
  );

  const jumpSelection = useCallback(
    (target: "top" | "bottom") => {
      if (navLevel === "sources" || focusedPane === "feeds") {
        setFeedIndex(target === "top" ? 0 : Math.max(0, snapshot.feeds.length));
        setArticleIndex(0);
      } else if (focusedPane === "articles") {
        setArticleIndex(target === "top" ? 0 : Math.max(0, snapshot.articles.length - 1));
      }
    },
    [focusedPane, navLevel, snapshot.articles.length, snapshot.feeds.length],
  );

  const activate = useCallback(() => {
    if (navLevel === "sources" || focusedPane === "feeds") {
      enterReadingLevel();
    } else if (focusedPane === "articles") {
      setFocusedPane("reader");
    }
  }, [enterReadingLevel, focusedPane, navLevel]);

  const toggleRead = useCallback(async () => {
    if (!selectedArticle) return;
    await sync.setRead(selectedArticle, !selectedArticle.isRead);
    refreshFromCache();
  }, [refreshFromCache, selectedArticle, sync]);

  const toggleStarred = useCallback(async () => {
    if (!selectedArticle) return;
    await sync.setStarred(selectedArticle, !selectedArticle.isStarred);
    refreshFromCache();
  }, [refreshFromCache, selectedArticle, sync]);

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
        { key: "/", cmd: "filter" },
        { key: "?", cmd: "help" },
        { key: "escape", cmd: "close-overlay" },
      ],
    }),
    [activate, filterMode, jumpSelection, moveFocus, moveSelection, renderer, runSync, toggleRead, toggleStarred],
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

  const showSourcesLayer = navLevel === "sources" || contentOffset > 0;
  const statusSource = navLevel === "sources" ? selectedSourceFeed : activeFeed;

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#101418">
      <box flexGrow={1} width="100%" position="relative" backgroundColor="#101418">
        {showSourcesLayer ? (
          <FeedPane
            mode={mode}
            focused={navLevel === "sources" || focusedPane === "feeds"}
            feeds={snapshot.feeds}
            selectedIndex={feedIndex}
            activeFeedId={activeFeedId}
            height={height}
          />
        ) : null}
        {mode !== "one" || navLevel === "reading" ? (
          <box
            position={mode === "one" ? "relative" : "absolute"}
            left={mode === "one" ? 0 : contentOffset}
            top={0}
            width="100%"
            height="100%"
            flexDirection="row"
          >
            {readingPanesForMode(mode, focusedPane).includes("articles") ? (
              <ArticlePane
                mode={mode}
                focused={navLevel === "reading" && focusedPane === "articles"}
                articles={snapshot.articles}
                selectedIndex={articleIndex}
                height={height}
                sourceTitle={activeFeed?.title ?? "All Unread"}
              />
            ) : null}
            {readingPanesForMode(mode, focusedPane).includes("reader") ? (
              <ReaderPane mode={mode} focused={navLevel === "reading" && focusedPane === "reader"} article={selectedArticle} width={width} height={height} />
            ) : null}
          </box>
        ) : null}
      </box>
      {helpOpen ? <HelpOverlay /> : null}
      <StatusBar
        snapshot={snapshot}
        focusedPane={focusedPane}
        filter={filter}
        filterMode={filterMode}
        busy={busy}
        selectedFeed={statusSource}
        activeFeed={activeFeed}
        navLevel={navLevel}
      />
    </box>
  );
}

function readingPanesForMode(mode: LayoutMode, focusedPane: Pane): Pane[] {
  if (mode === "one") return [focusedPane === "reader" ? "reader" : "articles"];
  return ["articles", "reader"];
}

function FeedPane({
  mode,
  focused,
  feeds,
  selectedIndex,
  activeFeedId,
  height,
}: {
  mode: LayoutMode;
  focused: boolean;
  feeds: Feed[];
  selectedIndex: number;
  activeFeedId: string | null;
  height: number;
}) {
  const totalUnread = feeds.reduce((total, feed) => total + feed.unreadCount, 0);
  const rows: SourceRow[] = [{ id: null, title: "All Unread", unreadCount: totalUnread }, ...feeds];
  const visible = windowAround(rows, selectedIndex, Math.max(3, height - 5));
  const width = mode === "one" ? "100%" : mode === "three" ? 38 : 34;

  return (
    <box width={width} height="100%" border borderColor={focused ? "#d7ba7d" : "#3a4450"} title="Sources" padding={1}>
      {visible.items.length === 0 ? <text fg="#8b949e">No feeds cached yet. Press r to sync.</text> : null}
      {visible.items.map((row, index) => {
        const absoluteIndex = visible.offset + index;
        const selected = absoluteIndex === selectedIndex;
        const active = row.id === activeFeedId;
        const label = `${row.unreadCount > 0 ? String(row.unreadCount).padStart(3, " ") : "   "} ${active ? "> " : "  "}${row.title}`;
        return (
          <text key={row.id ?? "all-unread"} fg={selected ? "#101418" : row.unreadCount > 0 ? "#f0f6fc" : "#8b949e"} bg={selected ? "#d7ba7d" : undefined}>
            {truncate(label, mode === "one" ? 80 : 38)}
          </text>
        );
      })}
    </box>
  );
}

interface SourceRow {
  id: string | null;
  title: string;
  unreadCount: number;
}

function ArticlePane({
  mode,
  focused,
  articles,
  selectedIndex,
  height,
  sourceTitle,
}: {
  mode: LayoutMode;
  focused: boolean;
  articles: Article[];
  selectedIndex: number;
  height: number;
  sourceTitle: string;
}) {
  const visible = windowAround(articles, selectedIndex, Math.max(3, height - 5));
  const width = mode === "one" ? "100%" : mode === "three" ? 42 : 34;

  return (
    <box width={width} height="100%" border borderColor={focused ? "#d7ba7d" : "#3a4450"} title={sourceTitle} padding={1}>
      {visible.items.length === 0 ? <text fg="#8b949e">No unread articles here.</text> : null}
      {visible.items.map((article, index) => {
        const absoluteIndex = visible.offset + index;
        const selected = absoluteIndex === selectedIndex;
        const marker = `${article.isStarred ? "*" : " "} ${article.isRead ? " " : "u"}`;
        const line = `${marker} ${truncate(article.title, mode === "one" ? 60 : mode === "three" ? 27 : 20)} ${formatDate(article.published)}`;
        return (
          <text key={article.id} fg={selected ? "#101418" : article.isRead ? "#8b949e" : "#f0f6fc"} bg={selected ? "#d7ba7d" : undefined}>
            {line}
          </text>
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
  height,
}: {
  mode: LayoutMode;
  focused: boolean;
  article: Article | null;
  width: number;
  height: number;
}) {
  const body = article ? htmlToText(article.content || article.summary) : "";
  const lines = article ? body.split("\n").slice(0, Math.max(4, height - 8)) : [];
  const readerWidth = mode === "three" ? width - 42 : mode === "two" ? width - 34 : width;
  const maxTitle = Math.max(20, Math.min(readerWidth - 8, mode === "three" ? 90 : readerWidth - 8));

  return (
    <box flexGrow={1} width="100%" height="100%" border borderColor={focused ? "#d7ba7d" : "#3a4450"} title="Reader" padding={1}>
      {!article ? (
        <text fg="#8b949e">Select an article.</text>
      ) : (
        <>
          <text fg="#f0f6fc">{truncate(article.title, maxTitle)}</text>
          <text fg="#8b949e">{truncate(article.originTitle ?? article.url ?? "", maxTitle)}</text>
          <text> </text>
          {lines.length === 0 ? <text fg="#8b949e">(empty article body)</text> : null}
          {lines.map((line, index) => (
            <text key={`${article.id}-${index}`} fg="#d0d7de">
              {truncate(line, Math.max(20, readerWidth - 8))}
            </text>
          ))}
        </>
      )}
    </box>
  );
}

function StatusBar({
  snapshot,
  focusedPane,
  filter,
  filterMode,
  busy,
  selectedFeed,
  activeFeed,
  navLevel,
}: {
  snapshot: SyncSnapshot;
  focusedPane: Pane;
  filter: string;
  filterMode: boolean;
  busy: boolean;
  selectedFeed: Feed | null;
  activeFeed: Feed | null;
  navLevel: NavLevel;
}) {
  const unread = snapshot.feeds.reduce((total, feed) => total + feed.unreadCount, 0);
  const left = `${busy ? "syncing" : snapshot.status} | ${navLevel}/${focusedPane} | unread ${unread}`;
  const middle = selectedFeed
    ? `${navLevel === "sources" ? "selected" : "source"}: ${selectedFeed.title}`
    : `source: ${activeFeed?.title ?? "All Unread"}`;
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
      width={64}
      height={14}
      border
      borderColor="#d7ba7d"
      backgroundColor="#101418"
      title="Keys"
      padding={1}
    >
      <text fg="#f0f6fc">h/l pane  j/k move  g/G top/bottom  enter open</text>
      <text fg="#f0f6fc">r sync  m read/unread  s star/unstar  / filter</text>
      <text fg="#f0f6fc">h from unread opens Sources  l or enter returns to reading</text>
      <text fg="#f0f6fc">escape close  q quit</text>
      <text> </text>
      <text fg="#8b949e">Wide terminals default to unread articles plus reader, with Sources one level up.</text>
    </box>
  );
}
