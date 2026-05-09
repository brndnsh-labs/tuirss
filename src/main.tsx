/** @jsxImportSource @opentui/react */

import { createCliRenderer } from "@opentui/core";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { KeymapProvider } from "@opentui/keymap/react";
import { createRoot } from "@opentui/react";
import { CacheStore } from "./cache";
import { loadConfig } from "./config";
import { GReaderClient } from "./greader";
import { SyncManager } from "./sync";
import { App } from "./ui/App";

const config = await loadConfig();
const cache = new CacheStore(config.cache.path);
cache.init();

const api = new GReaderClient({
  apiUrl: config.server.apiUrl,
  username: config.server.username,
  password: config.server.password,
});
const sync = new SyncManager(api, cache, config);

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useKittyKeyboard: {},
});
const keymap = createDefaultOpenTuiKeymap(renderer);

renderer.on("destroy", () => {
  cache.close();
});

createRoot(renderer).render(
  <KeymapProvider keymap={keymap}>
    <App sync={sync} renderer={renderer} initial={sync.snapshot()} syncOnStart={config.sync.syncOnStart} />
  </KeymapProvider>,
);
