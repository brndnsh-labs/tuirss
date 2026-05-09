import type {
  GReaderItem,
  StreamContentsResponse,
  SubscriptionListResponse,
  TagListResponse,
  UnreadCountResponse,
} from "./types";

export const READ_TAG = "user/-/state/com.google/read";
export const STARRED_TAG = "user/-/state/com.google/starred";
export const READING_LIST_STREAM = "reading-list";

export interface GReaderCredentials {
  apiUrl: string;
  username: string;
  password: string;
}

export class GReaderClient {
  private auth: string | null = null;
  private token: string | null = null;

  constructor(private readonly credentials: GReaderCredentials, private readonly fetcher: typeof fetch = fetch) {}

  get isAuthenticated(): boolean {
    return this.auth !== null;
  }

  async login(): Promise<void> {
    const body = new URLSearchParams({
      Email: this.credentials.username,
      Passwd: this.credentials.password,
    });

    const response = await this.fetcher(this.url("accounts/ClientLogin"), {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!response.ok) {
      throw new Error(`FreshRSS login failed: ${response.status} ${await response.text()}`);
    }

    const values = parseClientLogin(await response.text());
    if (!values.Auth) {
      throw new Error("FreshRSS login response did not include Auth");
    }

    this.auth = values.Auth;
    this.token = null;
  }

  async getSubscriptions(): Promise<SubscriptionListResponse> {
    return this.requestJson<SubscriptionListResponse>("reader/api/0/subscription/list", {
      query: { output: "json" },
    });
  }

  async getTags(): Promise<TagListResponse> {
    return this.requestJson<TagListResponse>("reader/api/0/tag/list", {
      query: { output: "json" },
    });
  }

  async getUnreadCounts(): Promise<UnreadCountResponse> {
    return this.requestJson<UnreadCountResponse>("reader/api/0/unread-count", {
      query: { output: "json" },
    });
  }

  async getStreamContents(
    streamId = READING_LIST_STREAM,
    options: { count?: number; continuation?: string; excludeRead?: boolean; newerThan?: number } = {},
  ): Promise<StreamContentsResponse> {
    const query: Record<string, string | number | boolean> = {
      output: "json",
      n: options.count ?? 50,
    };

    if (options.continuation) query.c = options.continuation;
    if (options.excludeRead) query.xt = READ_TAG;
    if (options.newerThan !== undefined) query.ot = options.newerThan;

    return this.requestJson<StreamContentsResponse>(`reader/api/0/stream/contents/${encodeStreamId(streamId)}`, {
      query,
    });
  }

  async markRead(itemIds: string[], read: boolean): Promise<void> {
    await this.editTag(itemIds, read ? [READ_TAG] : [], read ? [] : [READ_TAG]);
  }

  async markStarred(itemIds: string[], starred: boolean): Promise<void> {
    await this.editTag(itemIds, starred ? [STARRED_TAG] : [], starred ? [] : [STARRED_TAG]);
  }

  async editTag(itemIds: string[], add: string[], remove: string[]): Promise<void> {
    if (itemIds.length === 0) return;

    const body = new URLSearchParams();
    body.set("T", await this.getToken());
    body.set("ac", "edit-tags");
    body.set("async", "true");

    for (const id of itemIds) body.append("i", id);
    for (const tag of add) body.append("a", tag);
    for (const tag of remove) body.append("r", tag);

    const response = await this.fetcher(this.url("reader/api/0/edit-tag"), {
      method: "POST",
      body,
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!response.ok) {
      throw new Error(`edit-tag failed: ${response.status} ${await response.text()}`);
    }
  }

  private async getToken(): Promise<string> {
    if (this.token) return this.token;
    const response = await this.requestText("reader/api/0/token");
    this.token = response.trim();
    return this.token;
  }

  private async requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.fetcher(this.url(path, options.query), {
      method: options.method ?? "GET",
      body: options.body,
      headers: {
        ...this.authHeaders(),
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as T;
  }

  private async requestText(path: string, options: RequestOptions = {}): Promise<string> {
    const response = await this.fetcher(this.url(path, options.query), {
      method: options.method ?? "GET",
      body: options.body,
      headers: {
        ...this.authHeaders(),
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
    }

    return response.text();
  }

  private authHeaders(): Record<string, string> {
    if (!this.auth) {
      throw new Error("FreshRSS client is not authenticated");
    }

    return {
      Authorization: `GoogleLogin auth=${this.auth}`,
    };
  }

  private url(path: string, query: Record<string, string | number | boolean | undefined> = {}): string {
    const base = this.credentials.apiUrl.replace(/\/+$/, "");
    const url = new URL(`${base}/${path.replace(/^\/+/, "")}`);

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    return url.toString();
  }
}

interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: BodyInit;
  headers?: Record<string, string>;
}

export function parseClientLogin(input: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of input.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0) result[line.slice(0, index)] = line.slice(index + 1);
  }

  return result;
}

export function encodeStreamId(streamId: string): string {
  return streamId
    .split("/")
    .filter((part) => part.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

export function itemToArticleFlags(item: Pick<GReaderItem, "categories">): { isRead: boolean; isStarred: boolean } {
  const categories = item.categories ?? [];
  return {
    isRead: categories.includes(READ_TAG),
    isStarred: categories.includes(STARRED_TAG),
  };
}
