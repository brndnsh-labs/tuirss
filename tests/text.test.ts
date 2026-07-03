import { describe, expect, test } from "bun:test";
import { htmlToMarkdown, htmlToText, layoutMode, windowAround } from "../src/text";

describe("text helpers", () => {
  test("converts simple HTML to readable text", () => {
    expect(htmlToText("<h1>Title</h1><p>A&amp;B<br>Next</p>")).toBe("Title\nA&B\nNext");
  });

  test("converts article HTML to markdown", () => {
    const html =
      "<h2>Heading</h2><p>Intro with <strong>bold</strong> and <a href='https://example.com'>a link</a>.</p>" +
      "<ul><li>One</li><li>Two</li></ul><blockquote>Quote</blockquote><pre><code>const x = 1</code></pre>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("## Heading");
    expect(md).toContain("**bold**");
    expect(md).toContain("[a link](https://example.com)");
    expect(md).toContain("- One");
    expect(md).toContain("- Two");
    expect(md).toContain("> Quote");
    expect(md).toContain("```\nconst x = 1\n```");
  });

  test("ordered lists number sequentially and entities decode", () => {
    expect(htmlToMarkdown("<ol><li>First</li><li>Second</li></ol>")).toBe("1. First\n2. Second");
    expect(htmlToMarkdown("<p>A&amp;B &lt;tag&gt;</p>")).toBe("A&B <tag>");
  });

  test("drops javascript: links to their label", () => {
    expect(htmlToMarkdown("<p><a href='javascript:void(0)'>click</a></p>")).toBe("click");
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
