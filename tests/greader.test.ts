import { describe, expect, test } from "bun:test";
import { encodeStreamId, GReaderClient, parseClientLogin, READ_TAG, STARRED_TAG } from "../src/greader";

describe("GReaderClient", () => {
  test("parses ClientLogin response", () => {
    expect(parseClientLogin("SID=alice/token\nLSID=null\nAuth=alice/token\n")).toEqual({
      SID: "alice/token",
      LSID: "null",
      Auth: "alice/token",
    });
  });

  test("logs in and sends auth header for reads", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("ClientLogin")) return new Response("Auth=alice/token\n");
      return Response.json({ subscriptions: [] });
    };

    const client = new GReaderClient(
      {
        apiUrl: "http://example.test/api/greader.php",
        username: "alice",
        password: "secret",
      },
      fetcher as typeof fetch,
    );

    await client.login();
    await client.getSubscriptions();

    expect(calls[1].url).toContain("/reader/api/0/subscription/list?output=json");
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe("GoogleLogin auth=alice/token");
  });

  test("uses token and edit-tag payload for read and starred mutations", async () => {
    const bodies: string[] = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("ClientLogin")) return new Response("Auth=alice/token\n");
      if (String(url).endsWith("/token")) return new Response("write-token");
      if (String(url).endsWith("/edit-tag")) {
        bodies.push(String(init?.body));
        return new Response("OK");
      }
      return Response.json({});
    };

    const client = new GReaderClient(
      {
        apiUrl: "http://example.test/api/greader.php",
        username: "alice",
        password: "secret",
      },
      fetcher as typeof fetch,
    );

    await client.login();
    await client.markRead(["item-1"], true);
    await client.markStarred(["item-1"], false);

    expect(bodies[0]).toContain(`a=${encodeURIComponent(READ_TAG)}`);
    expect(bodies[0]).toContain("T=write-token");
    expect(bodies[1]).toContain(`r=${encodeURIComponent(STARRED_TAG)}`);
  });

  test("builds FreshRSS stream contents URLs without encoding slash separators", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).includes("ClientLogin")) return new Response("Auth=alice/token\n");
      return Response.json({ items: [] });
    };

    const client = new GReaderClient(
      {
        apiUrl: "http://example.test/api/greader.php",
        username: "alice",
        password: "secret",
      },
      fetcher as typeof fetch,
    );

    await client.login();
    await client.getStreamContents(undefined, { newerThan: 1710000000 });
    await client.getStreamContents("user/-/state/com.google/reading-list");

    expect(calls[1]).toContain("/reader/api/0/stream/contents/reading-list?output=json&n=50&ot=1710000000");
    expect(calls[2]).toContain("/reader/api/0/stream/contents/user/-/state/com.google/reading-list");
  });

  test("encodes stream id path segments but not the separators", () => {
    expect(encodeStreamId("user/-/label/Tech News")).toBe("user/-/label/Tech%20News");
  });
});
