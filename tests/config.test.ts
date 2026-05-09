import { describe, expect, test } from "bun:test";
import { normalizeApiUrl, parseConfig } from "../src/config";

describe("config", () => {
  test("normalizes FreshRSS API URL variants", () => {
    expect(normalizeApiUrl("http://docker01:8080/api/")).toBe("http://docker01:8080/api/greader.php");
    expect(normalizeApiUrl("http://docker01:8080/api/greader.php")).toBe("http://docker01:8080/api/greader.php");
    expect(normalizeApiUrl("http://docker01:8080")).toBe("http://docker01:8080/api/greader.php");
  });

  test("parses minimal config with defaults", () => {
    const config = parseConfig({
      server: {
        api_url: "http://docker01:8080/api/",
        username: "alice",
        password: "secret",
      },
    });

    expect(config.server.apiUrl).toBe("http://docker01:8080/api/greader.php");
    expect(config.cache.path).toBe("./tuirss.db");
    expect(config.sync.pageSize).toBe(50);
    expect(config.sync.maxPages).toBe(6);
    expect(config.sync.syncOnStart).toBe(true);
  });

  test("rejects placeholder credentials", () => {
    expect(() =>
      parseConfig({
        server: {
          api_url: "http://docker01:8080/api/",
          username: "your-freshrss-username",
          password: "your-freshrss-api-password",
        },
      }),
    ).toThrow("server.username");
  });
});
