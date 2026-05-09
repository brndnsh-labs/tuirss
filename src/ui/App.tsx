/** @jsxImportSource @opentui/react */

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useBindings } from "@opentui/keymap/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CliRenderer } from "@opentui/core";
import type { Article, Feed, LayoutMode, Pane } from "../types";
import type { SyncManager, SyncSnapshot } from "../sync";
import { clampIndex, formatDate, htmlToText, layoutMode, truncate, windowAround } from "../text";

const PANE_ORDER: Pane[] = ["feeds", "articles", "reader"];

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
  const [focusedPane, setFocusedPane] = useState<Pane>("feeds");
  const [feedIndex, setFeedIndex] = useState(0);
  const [articleIndex, setArticleIndex] = useState(0);
  const [filterMode, setFilterMode] = useState(false);
  const [filter, setFilter] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectedFeed = snapshot.feeds[clampIndex(feedIndex, snapshot.feeds.length)] ?? null;
  const articleOptions = useMemo(
    () => ({
      feedId: selectedFeed?.id ?? null,
      query: filter,
    }),
    [selectedFeed?.id, filter],
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
    setFeedIndex((current) => clampIndex(current, snapshot.feeds.length));
    setArticleIndex((current) => clampIndex(current, snapshot.articles.length));
  }, [snapshot.feeds.length, snapshot.articles.length]);

  const selectedArticle = snapshot.articles[clampIndex(articleIndex, snapshot.articles.length)] ?? null;

  const moveFocus = useCallback((direction: -1 | 1) => {
    setFocusedPane((current) => {
      const currentIndex = PANE_ORDER.indexOf(current);
      return PANE_ORDER[clampIndex(currentIndex + direction, PANE_ORDER.length)];
    });
  }, []);

  const moveSelection = useCallback(
    (direction: -1 | 1) => {
      if (focusedPane === "feeds") {
        setFeedIndex((current) => clampIndex(current + direction, snapshot.feeds.length));
        setArticleIndex(0);
      } else if (focusedPane === "articles") {
        setArticleIndex((current) => clampIndex(current + direction, snapshot.articles.length));
      }
    },
    [focusedPane, snapshot.articles.length, snapshot.feeds.length],
  );

  const jumpSelection = useCallback(
    (target: "top" | "bottom") => {
      if (focusedPane === "feeds") {
        setFeedIndex(target === "top" ? 0 : Math.max(0, snapshot.feeds.length - 1));
        setArticleIndex(0);
      } else if (focusedPane === "articles") {
        setArticleIndex(target === "top" ? 0 : Math.max(0, snapshot.articles.length - 1));
      }
    },
    [focusedPane, snapshot.articles.length, snapshot.feeds.length],
  );

  const activate = useCallback(() => {
    if (focusedPane === "feeds") {
      setFocusedPane(mode === "one" ? "articles" : "articles");
      setArticleIndex(0);
    } else if (focusedPane === "articles") {
      setFocusedPane("reader");
      if (selectedArticle && !selectedArticle.isRead) {
        void sync.setRead(selectedArticle, true).then(refreshFromCache);
      }
    }
  }, [focusedPane, mode, refreshFromCache, selectedArticle, sync]);

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

  const visiblePanes = panesForMode(mode, focusedPane);

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#101418">
      <box flexGrow={1} width="100%" flexDirection={mode === "one" ? "column" : "row"}>
        {visiblePanes.includes("feeds") ? (
          <FeedPane
            mode={mode}
            focused={focusedPane === "feeds"}
            feeds={snapshot.feeds}
            selectedIndex={feedIndex}
            height={height}
          />
        ) : null}
        {visiblePanes.includes("articles") ? (
          <ArticlePane
            mode={mode}
            focused={focusedPane === "articles"}
            articles={snapshot.articles}
            selectedIndex={articleIndex}
            height={height}
          />
        ) : null}
        {visiblePanes.includes("reader") ? (
          <ReaderPane mode={mode} focused={focusedPane === "reader"} article={selectedArticle} width={width} height={height} />
        ) : null}
      </box>
      {helpOpen ? <HelpOverlay /> : null}
      <StatusBar
        snapshot={snapshot}
        focusedPane={focusedPane}
        filter={filter}
        filterMode={filterMode}
        busy={busy}
        selectedFeed={selectedFeed}
      />
    </box>
  );
}

function panesForMode(mode: LayoutMode, focusedPane: Pane): Pane[] {
  if (mode === "three") return ["feeds", "articles", "reader"];
  if (mode === "two") return focusedPane === "feeds" ? ["feeds", "articles"] : ["articles", "reader"];
  return [focusedPane];
}

function FeedPane({
  mode,
  focused,
  feeds,
  selectedIndex,
  height,
}: {
  mode: LayoutMode;
  focused: boolean;
  feeds: Feed[];
  selectedIndex: number;
  height: number;
}) {
  const visible = windowAround(feeds, selectedIndex, Math.max(3, height - 5));
  const width = mode === "three" ? 30 : mode === "two" ? 34 : "100%";

  return (
    <box width={width} height="100%" border borderColor={focused ? "#d7ba7d" : "#3a4450"} title="Sources" padding={1}>
      {visible.items.length === 0 ? <text fg="#8b949e">No feeds cached yet. Press r to sync.</text> : null}
      {visible.items.map((feed, index) => {
        const absoluteIndex = visible.offset + index;
        const selected = absoluteIndex === selectedIndex;
        const label = `${feed.unreadCount > 0 ? String(feed.unreadCount).padStart(3, " ") : "   "} ${feed.title}`;
        return (
          <text key={feed.id} fg={selected ? "#101418" : feed.unreadCount > 0 ? "#f0f6fc" : "#8b949e"} bg={selected ? "#d7ba7d" : undefined}>
            {truncate(label, mode === "one" ? 80 : 28)}
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
}: {
  mode: LayoutMode;
  focused: boolean;
  articles: Article[];
  selectedIndex: number;
  height: number;
}) {
  const visible = windowAround(articles, selectedIndex, Math.max(3, height - 5));
  const width = mode === "three" ? 44 : "100%";

  return (
    <box width={width} height="100%" border borderColor={focused ? "#d7ba7d" : "#3a4450"} title="Articles" padding={1}>
      {visible.items.length === 0 ? <text fg="#8b949e">No articles for this source.</text> : null}
      {visible.items.map((article, index) => {
        const absoluteIndex = visible.offset + index;
        const selected = absoluteIndex === selectedIndex;
        const marker = `${article.isStarred ? "*" : " "} ${article.isRead ? " " : "u"}`;
        const line = `${marker} ${truncate(article.title, mode === "three" ? 29 : 60)} ${formatDate(article.published)}`;
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
  const panelWidth = mode === "three" ? "100%" : "100%";
  const maxTitle = Math.max(20, Math.min(width - 8, mode === "three" ? 70 : width - 8));

  return (
    <box flexGrow={1} width={panelWidth} height="100%" border borderColor={focused ? "#d7ba7d" : "#3a4450"} title="Reader" padding={1}>
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
              {truncate(line, Math.max(20, width - 8))}
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
}: {
  snapshot: SyncSnapshot;
  focusedPane: Pane;
  filter: string;
  filterMode: boolean;
  busy: boolean;
  selectedFeed: Feed | null;
}) {
  const unread = snapshot.feeds.reduce((total, feed) => total + feed.unreadCount, 0);
  const left = `${busy ? "syncing" : snapshot.status} | ${focusedPane} | unread ${unread}`;
  const middle = selectedFeed ? `source: ${selectedFeed.title}` : "all sources";
  const queue = snapshot.pendingMutations > 0 ? `${snapshot.pendingMutations} queued | ` : "";
  const right = filterMode ? `/${filter}` : `${queue}${snapshot.message}`;

  return (
    <box height={1} width="100%" flexDirection="row" justifyContent="space-between" backgroundColor="#1f252b">
      <text fg="#f0f6fc">{truncate(left, 34)}</text>
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
      width={58}
      height={13}
      border
      borderColor="#d7ba7d"
      backgroundColor="#101418"
      title="Keys"
      padding={1}
    >
      <text fg="#f0f6fc">h/l pane  j/k move  g/G top/bottom  enter open</text>
      <text fg="#f0f6fc">r sync  m read/unread  s star/unstar  / filter</text>
      <text fg="#f0f6fc">escape close  q quit</text>
      <text> </text>
      <text fg="#8b949e">Large terminals show 3 panes, medium terminals 2 panes, narrow terminals 1 pane.</text>
    </box>
  );
}
