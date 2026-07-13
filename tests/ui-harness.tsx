/** @jsxImportSource @opentui/react */

import { createTestRenderer } from "@opentui/core/testing";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { KeymapProvider } from "@opentui/keymap/react";
import { createRoot } from "@opentui/react";
import { CacheStore } from "../src/cache";
import { SyncManager } from "../src/sync";
import type { AppConfig, GReaderItem, GReaderSubscription, UnreadCountResponse } from "../src/types";
import { App } from "../src/ui/App";

export interface UiHarnessOptions {
  width?: number;
  height?: number;
  subscriptions?: GReaderSubscription[];
  items?: GReaderItem[];
  unreadCounts?: UnreadCountResponse;
}

export interface UiHarness {
  cache: CacheStore;
  /** Press keys through the mock terminal, then flush React + one render. */
  press: (...keys: string[]) => Promise<void>;
  /** Flush pending React updates and render one frame, returned as plain chars. */
  frame: () => Promise<string>;
  resize: (width: number, height: number) => void;
  destroy: () => void;
}

/**
 * Boots the real App against an in-memory cache and OpenTUI's headless test
 * renderer. No network: the sync client is a stub, so drive state through
 * the cache fixtures passed in options.
 */
export async function renderApp(options: UiHarnessOptions = {}): Promise<UiHarness> {
  const cache = new CacheStore(":memory:");
  cache.init();
  if (options.subscriptions) cache.upsertSubscriptions(options.subscriptions);
  if (options.items) cache.upsertArticles(options.items);
  if (options.unreadCounts) cache.upsertUnreadCounts(options.unreadCounts);

  const sync = new SyncManager(new StubClient() as never, cache, harnessConfig);

  const { renderer, mockInput, renderOnce, captureCharFrame, resize } = await createTestRenderer({
    width: options.width ?? 110,
    height: options.height ?? 30,
    // Match main.tsx, which enables the kitty keyboard protocol; it also makes
    // a bare ESC unambiguous for the mock key encoder.
    kittyKeyboard: true,
  });
  const keymap = createDefaultOpenTuiKeymap(renderer);

  createRoot(renderer).render(
    <KeymapProvider keymap={keymap}>
      <App sync={sync} renderer={renderer} initial={sync.snapshot({ unreadOnly: true })} syncOnStart={false} />
    </KeymapProvider>,
  );

  // React flushes passive effects (keymap layer registration) through its
  // scheduler, which can take more than one macrotask.
  const flush = async () => {
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      await renderOnce();
    }
  };

  // The markdown renderable spins up a Tree-sitter worker on its first mount;
  // that init is async and process-global, so pay it once up front (~40ms) and
  // every later render — including markdown remounts on article change — is fast.
  const warmup = async () => {
    for (let i = 0; i < 25; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3));
      await renderOnce();
    }
  };
  await warmup();

  return {
    cache,
    press: async (...keys: string[]) => {
      for (const key of keys) {
        mockInput.pressKey(key);
        await flush();
      }
    },
    frame: async () => {
      await flush();
      return captureCharFrame();
    },
    resize,
    destroy: () => {
      renderer.destroy();
      cache.close();
    },
  };
}

class StubClient {
  isAuthenticated = true;
  async login() {}
  async getSubscriptions() {
    return { subscriptions: [] };
  }
  async getUnreadCounts() {
    return { unreadcounts: [] };
  }
  async getStreamContents() {
    return { items: [] };
  }
  async markRead() {}
  async markStarred() {}
}

const harnessConfig: AppConfig = {
  server: {
    apiUrl: "http://example.test/api/greader.php",
    username: "alice",
    password: "secret",
  },
  cache: { path: ":memory:" },
  sync: { pageSize: 50, maxPages: 1, syncOnStart: false },
};

export function subscription(id: string, title: string): GReaderSubscription {
  return { id, title, categories: [] };
}

export function subscriptionWithCategory(
  id: string,
  title: string,
  categoryId: string,
  categoryLabel: string,
): GReaderSubscription {
  return { id, title, categories: [{ id: categoryId, label: categoryLabel }] };
}

export function item(id: string, feedId: string, title: string, body: string, published: number): GReaderItem {
  return {
    id,
    title,
    published,
    summary: { content: body },
    origin: { streamId: feedId, title: feedId },
  };
}
