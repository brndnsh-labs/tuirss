import { GReaderClient } from "./greader";
import { CacheStore } from "./cache";
import type { AppConfig, Article, Feed, GReaderItem } from "./types";

export type SyncStatus = "idle" | "authenticating" | "syncing" | "offline" | "error";

export interface SyncSnapshot {
  status: SyncStatus;
  message: string;
  syncedArticles: number;
  pendingMutations: number;
  feeds: Feed[];
  articles: Article[];
}

export class SyncManager {
  private status: SyncStatus = "idle";
  private message = "Idle";
  private syncedArticles = 0;

  constructor(
    private readonly api: GReaderClient,
    private readonly cache: CacheStore,
    private readonly config: AppConfig,
  ) {}

  snapshot(articleOptions: Parameters<CacheStore["listArticles"]>[0] = {}): SyncSnapshot {
    return {
      status: this.status,
      message: this.message,
      syncedArticles: this.syncedArticles,
      pendingMutations: this.cache.listPendingMutations().length,
      feeds: this.cache.listFeeds(),
      articles: this.cache.listArticles(articleOptions),
    };
  }

  async sync(articleOptions: Parameters<CacheStore["listArticles"]>[0] = {}): Promise<SyncSnapshot> {
    try {
      this.status = "authenticating";
      this.message = "Signing in";
      await this.ensureLogin();

      this.status = "syncing";
      this.message = "Replaying queued changes";
      await this.replayPendingMutations();

      this.message = "Syncing subscriptions";
      const [subscriptions, unreadCounts] = await Promise.all([this.api.getSubscriptions(), this.api.getUnreadCounts()]);
      this.cache.upsertSubscriptions(subscriptions.subscriptions ?? []);
      this.cache.upsertUnreadCounts(unreadCounts);

      this.message = "Syncing articles";
      this.syncedArticles = await this.syncReadingList();
      this.cache.setState("last_sync_at", String(Date.now()));

      this.status = "idle";
      this.message = `Synced ${this.syncedArticles} articles`;
      return this.snapshot(articleOptions);
    } catch (error) {
      this.status = this.api.isAuthenticated ? "error" : "offline";
      this.message = error instanceof Error ? error.message : String(error);
      return this.snapshot(articleOptions);
    }
  }

  async setRead(article: Article, read: boolean): Promise<void> {
    this.cache.markArticleRead(article.id, read);

    try {
      await this.ensureLogin();
      await this.api.markRead([article.id], read);
    } catch (error) {
      this.cache.enqueueMutation(article.id, "read", read, errorMessage(error));
    }
  }

  async setStarred(article: Article, starred: boolean): Promise<void> {
    this.cache.markArticleStarred(article.id, starred);

    try {
      await this.ensureLogin();
      await this.api.markStarred([article.id], starred);
    } catch (error) {
      this.cache.enqueueMutation(article.id, "starred", starred, errorMessage(error));
    }
  }

  private async ensureLogin(): Promise<void> {
    if (!this.api.isAuthenticated) {
      await this.api.login();
    }
  }

  private async replayPendingMutations(): Promise<void> {
    for (const mutation of this.cache.listPendingMutations()) {
      try {
        if (mutation.action === "read") {
          await this.api.markRead([mutation.articleId], mutation.desiredState);
        } else {
          await this.api.markStarred([mutation.articleId], mutation.desiredState);
        }
        this.cache.removePendingMutation(mutation.id);
      } catch (error) {
        this.cache.markPendingMutationError(mutation.id, errorMessage(error));
      }
    }
  }

  private async syncReadingList(): Promise<number> {
    let continuation: string | undefined;
    let total = 0;
    let newestTimestamp = readStoredTimestamp(this.cache.getState("last_article_timestamp"));
    const newerThan = newestTimestamp > 0 ? newestTimestamp - 1 : undefined;

    for (let page = 0; page < this.config.sync.maxPages; page += 1) {
      const response = await this.api.getStreamContents(undefined, {
        count: this.config.sync.pageSize,
        continuation,
        newerThan,
      });

      const items = response.items ?? [];
      this.cache.upsertArticles(items);
      total += items.length;
      newestTimestamp = Math.max(newestTimestamp, ...items.map(itemTimestampSeconds));
      continuation = response.continuation;

      if (!continuation || items.length === 0) break;
    }

    if (newestTimestamp > 0) {
      this.cache.setState("last_article_timestamp", String(newestTimestamp));
    }

    return total;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readStoredTimestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function itemTimestampSeconds(item: GReaderItem): number {
  const usec = item.timestampUsec ? Math.floor(Number(item.timestampUsec) / 1_000_000) : 0;
  const crawl = item.crawlTimeMsec ? Math.floor(Number(item.crawlTimeMsec) / 1_000) : 0;
  return Math.max(item.updated ?? 0, item.published ?? 0, usec, crawl);
}
