import { describe, expect, test } from "bun:test";
import { htmlToText, layoutMode, windowAround } from "../src/text";

describe("text helpers", () => {
  test("converts simple HTML to readable text", () => {
    expect(htmlToText("<h1>Title</h1><p>A&amp;B<br>Next</p>")).toBe("Title\nA&B\nNext");
  });

  test("selects responsive layout mode", () => {
    expect(layoutMode(140)).toBe("three");
    expect(layoutMode(100)).toBe("two");
    expect(layoutMode(60)).toBe("one");
  });

  test("windows list around selection", () => {
    expect(windowAround([1, 2, 3, 4, 5], 3, 3)).toEqual({ offset: 2, items: [3, 4, 5] });
  });
});
