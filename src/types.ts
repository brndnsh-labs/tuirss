export type Pane = "feeds" | "articles" | "reader";

export type LayoutMode = "one" | "two" | "three";

export type NavLevel = "sources" | "reading";

export type ArticleView = "unread" | "all" | "starred";

export interface AppConfig {
  server: {
    apiUrl: string;
    username: string;
    password: string;
  };
  cache: {
    path: string;
  };
  sync: {
    pageSize: number;
    maxPages: number;
    syncOnStart: boolean;
  };
}

export interface Feed {
  id: string;
  title: string;
  url: string | null;
  htmlUrl: string | null;
  iconUrl: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
  unreadCount: number;
  updatedAt: number;
}

export interface Article {
  id: string;
  feedId: string | null;
  title: string;
  author: string | null;
  published: number | null;
  updated: number | null;
  crawlTimeMsec: number | null;
  content: string;
  summary: string;
  url: string | null;
  isRead: boolean;
  isStarred: boolean;
  categories: string[];
  originTitle: string | null;
  syncedAt: number;
}

export interface PendingMutation {
  id: number;
  articleId: string;
  action: "read" | "starred";
  desiredState: boolean;
  createdAt: number;
  lastError: string | null;
}

export interface SubscriptionListResponse {
  subscriptions: GReaderSubscription[];
}

export interface GReaderSubscription {
  id: string;
  title?: string;
  sortid?: string;
  firstitemmsec?: string;
  url?: string;
  htmlUrl?: string;
  iconUrl?: string;
  categories?: Array<{ id: string; label?: string }>;
}

export interface UnreadCountResponse {
  max?: number;
  unreadcounts: Array<{
    id: string;
    count: number;
    newestItemTimestampUsec?: string;
  }>;
}

export interface StreamContentsResponse {
  id?: string;
  title?: string;
  description?: string;
  continuation?: string;
  updated?: number;
  items: GReaderItem[];
}

export interface GReaderItem {
  id: string;
  crawlTimeMsec?: string | number;
  timestampUsec?: string;
  published?: number;
  updated?: number;
  title?: string;
  author?: string;
  categories?: string[];
  summary?: { content?: string; direction?: string };
  content?: { content?: string; direction?: string };
  canonical?: Array<{ href?: string }>;
  alternate?: Array<{ href?: string; type?: string }>;
  origin?: {
    streamId?: string;
    title?: string;
    htmlUrl?: string;
  };
}
