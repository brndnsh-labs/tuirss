/** @jsxImportSource @opentui/react */

import { describe, expect, test } from "bun:test";
import { item, renderApp, subscription } from "./ui-harness";

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

    // Move to Feed Two ("All Feeds" is row 0) and open it.
    await ui.press("j", "j", "RETURN");
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
    expect(starred).toContain("No articles here."); // nothing starred in fixtures

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
