import { describe, expect, test } from "bun:test";
import { CacheStore } from "../src/cache";
import { READ_TAG, STARRED_TAG } from "../src/greader";

describe("CacheStore", () => {
  test("upserts feeds, unread counts, articles, and pending mutations", () => {
    const cache = new CacheStore(":memory:");
    cache.init();

    cache.upsertSubscriptions([
      {
        id: "feed/1",
        title: "Example",
        url: "https://example.test/feed.xml",
        htmlUrl: "https://example.test",
        categories: [{ id: "user/-/label/Tech", label: "Tech" }],
      },
    ]);
    cache.upsertUnreadCounts({ unreadcounts: [{ id: "feed/1", count: 2 }] });
    cache.upsertArticles([
      {
        id: "item/1",
        title: "First item",
        published: 1710000000,
        categories: [READ_TAG, STARRED_TAG],
        summary: { content: "<p>Hello</p>" },
        origin: { streamId: "feed/1", title: "Example" },
      },
    ]);

    expect(cache.listFeeds()[0].unreadCount).toBe(2);

    const article = cache.listArticles({ feedId: "feed/1" })[0];
    expect(article.title).toBe("First item");
    expect(article.isRead).toBe(true);
    expect(article.isStarred).toBe(true);

    cache.markArticleRead("item/1", false);
    cache.enqueueMutation("item/1", "read", false, "offline");
    cache.markArticleStarred("item/1", false);
    cache.enqueueMutation("item/1", "starred", false, "offline");
    cache.upsertArticles([
      {
        id: "item/1",
        title: "First item from server",
        published: 1710000001,
        categories: [READ_TAG, STARRED_TAG],
        summary: { content: "<p>Hello again</p>" },
        origin: { streamId: "feed/1", title: "Example" },
      },
    ]);

    expect(cache.getArticle("item/1")?.isRead).toBe(false);
    expect(cache.getArticle("item/1")?.isStarred).toBe(false);
    expect(cache.listPendingMutations()[0].lastError).toBe("offline");

    cache.close();
  });

  test("moves the feed unread badge in step with local read marks", () => {
    const cache = new CacheStore(":memory:");
    cache.init();

    cache.upsertSubscriptions([{ id: "feed/1", title: "Example", categories: [] }]);
    cache.upsertUnreadCounts({ unreadcounts: [{ id: "feed/1", count: 2 }] });
    cache.upsertArticles([
      { id: "item/1", title: "One", published: 1710000000, categories: [], origin: { streamId: "feed/1" } },
      { id: "item/2", title: "Two", published: 1710000001, categories: [], origin: { streamId: "feed/1" } },
    ]);

    cache.markArticleRead("item/1", true);
    expect(cache.listFeeds()[0].unreadCount).toBe(1);

    // Re-marking an already-read article must not double-decrement.
    cache.markArticleRead("item/1", true);
    expect(cache.listFeeds()[0].unreadCount).toBe(1);

    cache.markArticleRead("item/1", false);
    cache.markArticleRead("item/1", false);
    expect(cache.listFeeds()[0].unreadCount).toBe(2);

    cache.close();
  });

  test("drops feeds that disappeared from the subscription list", () => {
    const cache = new CacheStore(":memory:");
    cache.init();

    cache.upsertSubscriptions([
      { id: "feed/1", title: "One", categories: [] },
      { id: "feed/2", title: "Two", categories: [] },
    ]);
    cache.upsertSubscriptions([{ id: "feed/1", title: "One", categories: [] }]);

    expect(cache.listFeeds().map((feed) => feed.id)).toEqual(["feed/1"]);

    cache.close();
  });

  test("keeps only the latest queued mutation per article and action", () => {
    const cache = new CacheStore(":memory:");
    cache.init();

    cache.enqueueMutation("item/1", "read", true, "offline");
    cache.enqueueMutation("item/1", "read", false, "offline");
    cache.enqueueMutation("item/1", "starred", true, "offline");

    const pending = cache.listPendingMutations();
    expect(pending).toHaveLength(2);
    expect(pending.find((m) => m.action === "read")?.desiredState).toBe(false);
    expect(pending.find((m) => m.action === "starred")?.desiredState).toBe(true);

    cache.close();
  });

  test("prunes old read articles but keeps starred, unread, and recent ones", () => {
    const cache = new CacheStore(":memory:");
    cache.init();

    const old = 1_000_000; // 1970 + ~11 days
    const recent = Math.floor(Date.now() / 1000);
    cache.upsertArticles([
      { id: "item/old-read", title: "Old read", published: old, categories: [READ_TAG] },
      { id: "item/old-starred", title: "Old starred", published: old, categories: [READ_TAG, STARRED_TAG] },
      { id: "item/old-unread", title: "Old unread", published: old, categories: [] },
      { id: "item/recent-read", title: "Recent read", published: recent, categories: [READ_TAG] },
    ]);

    expect(cache.pruneArticles(30)).toBe(1);
    expect(cache.listArticles().map((article) => article.id).sort()).toEqual([
      "item/old-starred",
      "item/old-unread",
      "item/recent-read",
    ]);

    cache.close();
  });
});
