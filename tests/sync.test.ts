import { describe, expect, test } from "bun:test";
import { CacheStore } from "../src/cache";
import { SyncManager } from "../src/sync";
import type { AppConfig } from "../src/types";

describe("SyncManager", () => {
  test("stores article timestamp and uses it for the next incremental sync", async () => {
    const cache = new CacheStore(":memory:");
    cache.init();

    const client = new FakeClient();
    const sync = new SyncManager(client as never, cache, testConfig);

    await sync.sync();
    await sync.sync();

    expect(client.streamCalls[0]?.newerThan).toBeUndefined();
    expect(client.streamCalls[1]?.newerThan).toBe(1710000004);
    expect(cache.getState("last_article_timestamp")).toBe("1710000005");

    cache.close();
  });

  test("reports progress messages during sync", async () => {
    const cache = new CacheStore(":memory:");
    cache.init();
    const sync = new SyncManager(new FakeClient() as never, cache, testConfig);

    const messages: string[] = [];
    await sync.sync({}, (snapshot) => messages.push(snapshot.message));

    expect(messages).toContain("Signing in");
    expect(messages).toContain("Syncing subscriptions");
    expect(messages).toContain("Syncing articles");

    cache.close();
  });
});

class FakeClient {
  isAuthenticated = false;
  streamCalls: Array<{ count?: number; continuation?: string; excludeRead?: boolean; newerThan?: number }> = [];

  async login() {
    this.isAuthenticated = true;
  }

  async getSubscriptions() {
    return { subscriptions: [] };
  }

  async getUnreadCounts() {
    return { unreadcounts: [] };
  }

  async getStreamContents(
    _streamId?: string,
    options: { count?: number; continuation?: string; excludeRead?: boolean; newerThan?: number } = {},
  ) {
    this.streamCalls.push(options);
    return {
      items: [
        {
          id: "item/1",
          title: "First",
          timestampUsec: "1710000005000000",
          summary: { content: "Hello" },
        },
      ],
    };
  }
}

const testConfig: AppConfig = {
  server: {
    apiUrl: "http://example.test/api/greader.php",
    username: "alice",
    password: "secret",
  },
  cache: {
    path: ":memory:",
  },
  sync: {
    pageSize: 50,
    maxPages: 1,
    syncOnStart: false,
  },
};
