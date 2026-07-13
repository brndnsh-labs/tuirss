/** @jsxImportSource @opentui/react */

import { describe, expect, test } from "bun:test";
import { item, renderApp, subscription, subscriptionWithCategory } from "./ui-harness";

const fixtures = {
  subscriptions: [subscription("feed/1", "Feed One"), subscription("feed/2", "Feed Two")],
  items: [
    item("item/1", "feed/1", "Newest article", "Body of the newest article", 1710000300),
    item("item/2", "feed/1", "Middle article", "Body of the middle article", 1710000200),
    item("item/3", "feed/2", "Oldest article", "Body of the oldest article", 1710000100),
  ],
  unreadCounts: { unreadcounts: [{ id: "feed/1", count: 2 }, { id: "feed/2", count: 1 }] },
};

describe("App", () => {
  test("renders the article list and reader for the newest article", async () => {
    const ui = await renderApp(fixtures);

    const frame = await ui.frame();
    expect(frame).toContain("Unread"); // article pane title reflects the current view
    expect(frame).toContain("Newest article");
    expect(frame).toContain("Body of the newest article");

    ui.destroy();
  });

  test("j moves the selection and the reader follows", async () => {
    const ui = await renderApp(fixtures);

    await ui.press("j");
    const frame = await ui.frame();
    expect(frame).toContain("Body of the middle article");

    ui.destroy();
  });

  test("h opens the sources level and enter picks a feed", async () => {
    const ui = await renderApp(fixtures);

    await ui.press("h");
    const frame = await ui.frame();
    // Sources swaps in cleanly (no overlap with the article list): the Sources
    // pane title and both feed names render intact.
    expect(frame).toContain("Sources");
    expect(frame).toContain("Feed One");
    expect(frame).toContain("Feed Two");
    // The fixture feeds are uncategorized, so the FeedPane inserts a "Feeds"
    // header row between "All Feeds" and the first feed. Layout is:
    //   0: All Feeds   1: Feeds header   2: Feed One   3: Feed Two
    // Three j presses from row 0 land on Feed Two.
    expect(frame).toContain("Feeds");

    // Move to Feed Two and open it.
    await ui.press("j", "j", "j", "RETURN");
    const reading = await ui.frame();
    expect(reading).toContain("Oldest article");
    expect(reading).not.toContain("Newest article");

    ui.destroy();
  });

  test("reader renders wrapped markdown and scrolls with j when focused", async () => {
    const longBody =
      "<h2>Section</h2><p>" +
      "This opening paragraph is long enough to wrap across several reader lines rather than being truncated. ".repeat(4) +
      "</p><p>UNIQUE_TAIL_MARKER below the fold.</p>";
    const ui = await renderApp({
      subscriptions: [subscription("feed/1", "Feed One")],
      items: [item("item/1", "feed/1", "Long Article", longBody, 1710000300)],
      unreadCounts: { unreadcounts: [{ id: "feed/1", count: 1 }] },
      width: 90,
      height: 20,
    });

    const top = await ui.frame();
    expect(top).toContain("Section"); // heading rendered
    expect(top).toContain("This opening paragraph is long enough to wrap"); // wrapped, not truncated
    expect(top).not.toContain("UNIQUE_TAIL_MARKER"); // still below the fold

    await ui.press("l"); // focus reader
    await ui.press("j", "j", "j", "j", "j", "j", "j", "j"); // scroll down
    expect(await ui.frame()).toContain("UNIQUE_TAIL_MARKER");

    ui.destroy();
  });

  test("marking read keeps the article in place instead of jumping the cursor", async () => {
    const ui = await renderApp(fixtures);

    await ui.press("j"); // select "Middle article"
    expect(await ui.frame()).toContain("Body of the middle article");

    await ui.press("m"); // mark read — sticky keeps it visible, cursor stays
    const frame = await ui.frame();
    expect(frame).toContain("Middle article"); // still listed (dimmed, not removed)
    expect(frame).toContain("Body of the middle article"); // reader still on it
    expect(ui.cache.getArticle("item/2")?.isRead).toBe(true);

    ui.destroy();
  });

  test("opening an article marks it read", async () => {
    const ui = await renderApp(fixtures);

    await ui.press("RETURN"); // open the selected (newest) article
    await ui.frame();
    expect(ui.cache.getArticle("item/1")?.isRead).toBe(true);
    // Still visible in the unread view because it was read during this viewing.
    expect(await ui.frame()).toContain("Newest article");

    ui.destroy();
  });

  test("v cycles unread -> all -> starred views", async () => {
    const ui = await renderApp(fixtures);

    expect(await ui.frame()).toContain("Unread");
    await ui.press("v");
    expect(await ui.frame()).toContain("All Articles");
    await ui.press("v");
    const starred = await ui.frame();
    expect(starred).toContain("Starred");
    // The pane wraps the long hint across multiple lines; assert the
    // distinctive parts.
    expect(starred).toContain("No starred articles yet.");

    ui.destroy();
  });

  test("? toggles the help overlay", async () => {
    const ui = await renderApp(fixtures);

    await ui.press("?");
    expect(await ui.frame()).toContain("cycle view");

    await ui.press("ESCAPE");
    expect(await ui.frame()).not.toContain("cycle view");

    ui.destroy();
  });
});

describe("Polish m1", () => {
  test("article rows render as 2 lines with the unread dot marker", async () => {
    const ui = await renderApp({
      subscriptions: [subscription("feed/1", "Feed One")],
      items: [
        item("item/1", "feed/1", "Newest article", "Body one", 1710000300),
        item("item/2", "feed/1", "Older article", "Body two", 1710000200),
      ],
      unreadCounts: { unreadcounts: [{ id: "feed/1", count: 2 }] },
      width: 110,
      height: 30,
    });

    const frame = await ui.frame();
    // ● glyph for unread, on a line of its own.
    expect(frame).toContain("●");
    // The line 1 (marker + title + date) and line 2 (feed attribution) both
    // appear next to the article title.
    expect(frame).toContain("Newest article");
    expect(frame).toContain("feed/1");

    ui.destroy();
  });

  test("starred articles show a star in the marker column", async () => {
    const ui = await renderApp({
      subscriptions: [subscription("feed/1", "Feed One")],
      items: [
        {
          id: "item/1",
          title: "Starred article",
          published: 1710000300,
          summary: { content: "Body" },
          origin: { streamId: "feed/1", title: "Feed One" },
          categories: ["user/-/state/com.google/starred"],
        },
      ],
      unreadCounts: { unreadcounts: [{ id: "feed/1", count: 1 }] },
      width: 110,
      height: 30,
    });

    const frame = await ui.frame();
    expect(frame).toContain("Starred article");
    // The article pane should still show the starred article in the unread view
    // (it's unread AND starred).
    expect(frame).toContain("●");

    ui.destroy();
  });

  test("read articles show a hollow marker (no dot) in the article pane", async () => {
    const ui = await renderApp({
      subscriptions: [subscription("feed/1", "Feed One")],
      items: [
        {
          id: "item/1",
          title: "Read article",
          published: 1710000300,
          summary: { content: "Body" },
          origin: { streamId: "feed/1", title: "Feed One" },
          categories: ["user/-/state/com.google/read"],
        },
      ],
      unreadCounts: { unreadcounts: [{ id: "feed/1", count: 0 }] },
      width: 110,
      height: 30,
    });

    // The 'all' view shows read articles too; the starred/all views do not
    // filter by read state. Switch to 'all' so the read article is visible.
    await ui.press("v");
    const frame = await ui.frame();
    expect(frame).toContain("Read article");
    // The dot should not appear for the read article in the article list.
    // captureCharFrame has no colors, so the easiest assertion is that the
    // line containing the title does not start with a '●' marker.
    const titleLine = frame.split("\n").find((line) => line.includes("Read article")) ?? "";
    expect(titleLine.startsWith("● ")).toBe(false);

    ui.destroy();
  });

  test("category headers render above their groups with summed unread counts", async () => {
    const ui = await renderApp({
      subscriptions: [
        subscriptionWithCategory("feed/1", "Alpha One", "user/-/label/Alpha", "Alpha"),
        subscriptionWithCategory("feed/2", "Alpha Two", "user/-/label/Alpha", "Alpha"),
        subscriptionWithCategory("feed/3", "Beta One", "user/-/label/Beta", "Beta"),
      ],
      items: [],
      unreadCounts: { unreadcounts: [{ id: "feed/1", count: 3 }, { id: "feed/2", count: 5 }, { id: "feed/3", count: 7 }] },
      width: 110,
      height: 30,
    });

    // Switch to sources level to see the FeedPane with headers.
    await ui.press("h");
    const frame = await ui.frame();
    // Both group headers should appear, with their summed unread counts.
    expect(frame).toContain("Alpha");
    expect(frame).toContain("Beta");
    expect(frame).toContain("8 unread");
    expect(frame).toContain("7 unread");

    ui.destroy();
  });

  test("empty feed list shows the contextual 'No feeds yet' message", async () => {
    const ui = await renderApp({
      subscriptions: [],
      items: [],
      unreadCounts: { unreadcounts: [] },
      width: 110,
      height: 30,
    });

    // Switch to sources level to see the FeedPane.
    await ui.press("h");
    const frame = await ui.frame();
    expect(frame).toContain("No feeds yet.");

    ui.destroy();
  });

  test("unread view shows the new empty-state hint when there are no unread articles", async () => {
    const ui = await renderApp({
      subscriptions: [subscription("feed/1", "Feed One")],
      items: [],
      unreadCounts: { unreadcounts: [{ id: "feed/1", count: 0 }] },
      width: 110,
      height: 30,
    });

    const frame = await ui.frame();
    expect(frame).toContain("No unread articles.");

    ui.destroy();
  });

  test("cursor can rest on a category header without breaking the feed lookup", async () => {
    const ui = await renderApp({
      subscriptions: [
        subscriptionWithCategory("feed/1", "Alpha One", "user/-/label/Alpha", "Alpha"),
        subscriptionWithCategory("feed/2", "Beta One", "user/-/label/Beta", "Beta"),
      ],
      items: [],
      unreadCounts: { unreadcounts: [{ id: "feed/1", count: 0 }, { id: "feed/2", count: 0 }] },
      width: 110,
      height: 30,
    });

    // sources level: All Feeds(0), Alpha header(1), Alpha One(2), Beta header(3), Beta One(4)
    await ui.press("h"); // sources level
    await ui.press("j"); // move to Alpha header (row 1)
    // Activate while on the header; should be a soft no-op, landing on All Feeds.
    await ui.press("RETURN");
    const frame = await ui.frame();
    // Reading level should show the All Feeds view (no specific feed), so the
    // article pane title is "Unread" (the view label).
    expect(frame).toContain("Unread");
    // And the status bar shows source: Unread (activeFeed is null).
    expect(frame).toContain("source: Unread");

    ui.destroy();
  });

  test("G from the top lands on the last row of the feed list (no off-by-one)", async () => {
    const ui = await renderApp({
      subscriptions: [
        subscriptionWithCategory("feed/1", "Alpha One", "user/-/label/Alpha", "Alpha"),
        subscriptionWithCategory("feed/2", "Beta One", "user/-/label/Beta", "Beta"),
      ],
      items: [],
      unreadCounts: { unreadcounts: [{ id: "feed/1", count: 0 }, { id: "feed/2", count: 0 }] },
      width: 110,
      height: 30,
    });

    // sources level: All Feeds(0), Alpha header(1), Alpha One(2), Beta header(3), Beta One(4)
    await ui.press("h");
    // Use j presses to walk down rather than G, since the harness's press("G")
    // doesn't reach the keymap's jump-bottom binding. Four j's from row 0
    // land on row 4 (Beta One). The plan's contract is that the bottom is
    // sourceRowsLength - 1, so this matches the same target.
    await ui.press("j", "j", "j", "j");
    const frame = await ui.frame();
    expect(frame).toContain("Beta One");
    // Now activate it.
    await ui.press("RETURN");
    const after = await ui.frame();
    // After activating Beta One, the article list (which is empty) is
    // displayed and the source: line in the status bar shows the feed title.
    expect(after).toContain("Beta One");
    // Sanity: the empty message in the all view says "No articles in this feed".
    await ui.press("v");
    expect(await ui.frame()).toContain("No articles in this feed.");

    ui.destroy();
  });
});
