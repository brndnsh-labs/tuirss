import type { AppConfig } from "./types";

const DEFAULT_CONFIG_PATH = "./config.toml";

export function normalizeApiUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");

  if (!trimmed) {
    throw new Error("server.api_url is required");
  }

  if (trimmed.endsWith("/api/greader.php")) {
    return trimmed;
  }

  if (trimmed.endsWith("/api")) {
    return `${trimmed}/greader.php`;
  }

  if (trimmed.endsWith("/greader.php")) {
    return trimmed;
  }

  return `${trimmed}/api/greader.php`;
}

export async function loadConfig(path = process.env.TUIRSS_CONFIG ?? DEFAULT_CONFIG_PATH): Promise<AppConfig> {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    throw new Error(`Config file not found: ${path}. Copy config.example.toml to config.toml and fill it in.`);
  }

  const parsed = Bun.TOML.parse(await file.text()) as Record<string, unknown>;
  return parseConfig(parsed);
}

export function parseConfig(parsed: Record<string, unknown>): AppConfig {
  const server = readTable(parsed, "server");
  const cache = readTable(parsed, "cache", {});
  const sync = readTable(parsed, "sync", {});

  const username = readString(server, "username");
  const password = readString(server, "password");

  if (!username || username === "your-freshrss-username") {
    throw new Error("server.username must be set in config.toml");
  }

  if (!password || password === "your-freshrss-api-password") {
    throw new Error("server.password must be set to the FreshRSS API password");
  }

  return {
    server: {
      apiUrl: normalizeApiUrl(readString(server, "api_url") || "http://docker01:8080/api/"),
      username,
      password,
    },
    cache: {
      path: readString(cache, "path") || "./tuirss.db",
    },
    sync: {
      pageSize: readPositiveInteger(sync, "page_size", 50),
      maxPages: readPositiveInteger(sync, "max_pages", 6),
      syncOnStart: readBoolean(sync, "sync_on_start", true),
    },
  };
}

function readTable(source: Record<string, unknown>, key: string, fallback?: Record<string, unknown>): Record<string, unknown> {
  const value = source[key];
  if (value === undefined && fallback) return fallback;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`[${key}] must be a TOML table`);
  }
  return value as Record<string, unknown>;
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function readPositiveInteger(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = source[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function readBoolean(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}
