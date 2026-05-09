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
});
