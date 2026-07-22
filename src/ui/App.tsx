/** @jsxImportSource @opentui/react */

import { useBindings } from "@opentui/keymap/react";
import { useTerminalDimensions } from "@opentui/react";
import type { CliRenderer, ScrollBoxRenderable } from "@opentui/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArticleView, Feed, LayoutMode, NavLevel, Pane } from "../types";
import type { SyncManager, SyncSnapshot } from "../sync";
import { layoutMode } from "../text";
import { ArticleList, FilterInput, Reader, Sources, buildSourceRows, VIEW_LABEL } from "./panes";
import { HelpOverlay, StatusBar } from "./overlays";
import { COLORS, SPINNER_FRAMES } from "./theme";

const VIEW_ORDER: ArticleView[] = ["unread", "all", "starred"];
const READER_SCROLL_STEP = 3;

interface AppProps {
  sync: SyncManager;
  renderer: CliRenderer;
  initial: SyncSnapshot;
  syncOnStart: boolean;
}

export function App({ sync, renderer, initial, syncOnStart }: AppProps) {
  const { width } = useTerminalDimensions();
  const mode = layoutMode(width);
  const [snapshot, setSnapshot] = useState(initial);
  const [focusedPane, setFocusedPane] = useState<Pane>("articles");
  const navLevel: NavLevel = focusedPane === "feeds" ? "sources" : "reading";
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

  // Lifted out of FeedPane so App can answer "what feed is at index N?"
  // without re-walking the feeds (and getting the wrong answer when the
  // index lands on a header row).
  const sourceRows = useMemo(() => buildSourceRows(snapshot.feeds), [snapshot.feeds]);
  const sourceRowsLength = sourceRows.length;
  const selectedSourceRow = useMemo(() => sourceRows[feedIndex] ?? null, [sourceRows, feedIndex]);
  const selectedSourceFeed = useMemo<Feed | null>(() => {
    if (selectedSourceRow?.kind !== "feed") return null;
    return snapshot.feeds.find((feed) => feed.id === selectedSourceRow.id) ?? null;
  }, [selectedSourceRow, snapshot.feeds]);

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

  useEffect(() => {
    if (!busy) {
      setSpinnerFrame(0);
      return;
    }
    const interval = setInterval(
      () => setSpinnerFrame((frame) => (frame + 1) % SPINNER_FRAMES.length),
      90,
    );
    return () => clearInterval(interval);
  }, [busy]);

  useEffect(() => {
    setFeedIndex((current) => Math.max(0, Math.min(current, sourceRowsLength - 1)));
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

  const enterReadingLevel = useCallback(() => {
    const newFeedId = selectedSourceRow?.kind === "feed" ? selectedSourceRow.id : null;
    const feedChanged = newFeedId !== activeFeedId;
    setActiveFeedId(newFeedId);
    setFocusedPane("articles");
    if (feedChanged) {
      setSelectedArticleId(null);
      setStickyReadIds(new Set());
    }
  }, [selectedSourceRow, activeFeedId]);

  const openArticle = useCallback(() => {
    setFocusedPane("reader");
    const article = snapshot.articles.find((candidate) => candidate.id === selectedArticleId);
    if (article && !article.isRead) {
      // Adding to the sticky set changes articleOptions, which re-runs the
      // cache refresh effect. setRead writes to SQLite synchronously before its
      // first await, so that refresh already sees the new read state — no manual
      // refresh here, which would query with the pre-sticky options and briefly
      // drop the article, jumping the cursor.
      setStickyReadIds((prev) => new Set(prev).add(article.id));
      void sync.setRead(article, true);
    }
  }, [selectedArticleId, snapshot.articles, sync]);

  const moveFocus = useCallback(
    (direction: -1 | 1) => {
      const panes: Pane[] = ["feeds", "articles", "reader"];
      const current = panes.indexOf(focusedPane);
      const next = current + direction;
      if (next < 0 || next >= panes.length) return;
      const target = panes[next];
      if (target === "feeds") {
        setFocusedPane("feeds");
      } else if (target === "articles") {
        if (focusedPane === "feeds") {
          enterReadingLevel();
        } else {
          setFocusedPane("articles");
        }
      } else {
        if (focusedPane !== "reader") openArticle();
      }
    },
    [enterReadingLevel, focusedPane, openArticle],
  );

  const jumpSelection = useCallback(
    (target: "top" | "bottom") => {
      if (focusedPane === "reader") {
        const scroll = readerScrollRef.current;
        if (scroll) scroll.scrollTo(target === "top" ? 0 : scroll.scrollHeight);
        return;
      }
      if (focusedPane === "feeds") {
        setFeedIndex(target === "top" ? 0 : Math.max(0, sourceRowsLength - 1));
        return;
      }
      const last = snapshot.articles.length - 1;
      const targetArticle = snapshot.articles[target === "top" ? 0 : last];
      if (targetArticle) setSelectedArticleId(targetArticle.id);
    },
    [focusedPane, snapshot.articles, sourceRowsLength],
  );

  const moveSelection = useCallback(
    (direction: -1 | 1) => {
      if (focusedPane === "reader") {
        readerScrollRef.current?.scrollBy(direction * READER_SCROLL_STEP);
        return;
      }
      if (focusedPane === "feeds") {
        setFeedIndex((current) => Math.max(0, Math.min(current + direction, sourceRowsLength - 1)));
        return;
      }
      // articles: move by id so the <select> syncs through selectedArticleId.
      const currentIndex = snapshot.articles.findIndex((article) => article.id === selectedArticleId);
      const nextIndex = currentIndex < 0 ? 0 : Math.max(0, Math.min(currentIndex + direction, snapshot.articles.length - 1));
      const nextArticle = snapshot.articles[nextIndex];
      if (nextArticle) setSelectedArticleId(nextArticle.id);
    },
    [focusedPane, selectedArticleId, snapshot.articles, sourceRowsLength],
  );

  const activate = useCallback(() => {
    if (focusedPane === "feeds") {
      enterReadingLevel();
    } else if (focusedPane === "articles") {
      openArticle();
    }
  }, [enterReadingLevel, focusedPane, openArticle]);

  const cycleView = useCallback(() => {
    setView((current) => VIEW_ORDER[(VIEW_ORDER.indexOf(current) + 1) % VIEW_ORDER.length]);
    setStickyReadIds(new Set());
    setSelectedArticleId(null);
  }, []);

  const toggleRead = useCallback(async () => {
    const article = snapshot.articles.find((candidate) => candidate.id === selectedArticleId);
    if (!article) return;
    const nextRead = !article.isRead;
    if (nextRead) {
      setStickyReadIds((prev) => new Set(prev).add(article.id));
      await sync.setRead(article, true);
    } else {
      await sync.setRead(article, false);
      refreshFromCache();
    }
  }, [refreshFromCache, selectedArticleId, snapshot.articles, sync]);

  const toggleStarred = useCallback(async () => {
    const article = snapshot.articles.find((candidate) => candidate.id === selectedArticleId);
    if (!article) return;
    await sync.setStarred(article, !article.isStarred);
    refreshFromCache();
  }, [refreshFromCache, selectedArticleId, snapshot.articles, sync]);

  const openInBrowser = useCallback(() => {
    const article = snapshot.articles.find((candidate) => candidate.id === selectedArticleId);
    const url = article?.url;
    if (url) openUrl(url);
  }, [selectedArticleId, snapshot.articles]);

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
        { key: "ctrl+c", cmd: "quit" },
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

  const statusSource = focusedPane === "feeds" ? selectedSourceFeed : activeFeed;

  // Which panes are visible based on mode and navigation state.
  const visiblePanes = useMemo(() => visiblePanesForMode(mode, focusedPane), [mode, focusedPane]);
  const showFeeds = visiblePanes.includes("feeds");
  const showArticles = visiblePanes.includes("articles");
  const showReader = visiblePanes.includes("reader");
  // When the filter input is active, the underlying select/scrollbox is
  // not focused — the input takes over and the global keymap is disabled.
  const feedsFocused = focusedPane === "feeds" && !filterMode;
  const articlesFocused = focusedPane === "articles" && !filterMode;
  const readerFocused = focusedPane === "reader" && !filterMode;

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={COLORS.bg}>
      <box flexGrow={1} width="100%" flexDirection="row">
        {showFeeds ? (
          <Sources
            rows={sourceRows}
            selectedIndex={feedIndex}
            onSelectedIndexChange={setFeedIndex}
            activeFeedId={activeFeedId}
            focused={feedsFocused}
            mode={mode}
          />
        ) : null}
        {showArticles ? (
          <ArticleList
            articles={snapshot.articles}
            selectedArticleId={selectedArticleId}
            onSelect={setSelectedArticleId}
            focused={articlesFocused}
            mode={mode}
            sourceTitle={activeFeed?.title ?? VIEW_LABEL[view]}
            view={view}
          />
        ) : null}
        {showReader ? (
          <Reader
            mode={mode}
            focused={readerFocused}
            article={snapshot.articles.find((article) => article.id === selectedArticleId) ?? null}
            width={width}
            scrollRef={readerScrollRef}
          />
        ) : null}
      </box>
      {filterMode ? (
        <FilterInput
          value={filter}
          onChange={setFilter}
          onSubmit={() => setFilterMode(false)}
        />
      ) : null}
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
        width={width}
      />
    </box>
  );
}

function visiblePanesForMode(mode: LayoutMode, focusedPane: Pane): Pane[] {
  switch (mode) {
    case "one":
      return [focusedPane];
    case "two":
      return focusedPane === "feeds" ? ["feeds", "articles"] : ["articles", "reader"];
    case "three":
      return ["feeds", "articles", "reader"];
  }
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
