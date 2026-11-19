package render

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

func plain(t *testing.T, src string, width int) (string, []string) {
	t.Helper()
	res := HTML(src, width, "https://blog.example/post/", Styles{})
	out := ansi.Strip(res.Body)
	for _, line := range strings.Split(out, "\n") {
		if w := ansi.StringWidth(line); w > width {
			t.Errorf("line wider than %d (%d): %q", width, w, line)
		}
	}
	return out, res.Links
}

func TestParagraphsAndInline(t *testing.T) {
	out, _ := plain(t, `<p>Hello <b>bold</b>  and
		<em>italic</em> text.</p><p>Second</p>`, 40)
	want := "Hello bold and italic text.\n\nSecond\n"
	if out != want {
		t.Errorf("got %q want %q", out, want)
	}
}

func TestWrapping(t *testing.T) {
	out, _ := plain(t, `<p>`+strings.Repeat("word ", 30)+`</p>`, 20)
	if n := strings.Count(out, "\n"); n < 5 {
		t.Errorf("expected wrapping, got %q", out)
	}
}

func TestLinksAreNumberedAndResolved(t *testing.T) {
	out, links := plain(t, `<p>See <a href="/a">this</a>, <a href="https://x.example/">that</a> and <a href="/a">this again</a>. <a href="#top">anchor</a></p>`, 80)
	if !strings.Contains(out, "this[1]") || !strings.Contains(out, "that[2]") || !strings.Contains(out, "this again[1]") {
		t.Errorf("got %q", out)
	}
	if len(links) != 2 || links[0] != "https://blog.example/a" {
		t.Errorf("links = %v", links)
	}
	if strings.Contains(out, "anchor[") {
		t.Errorf("in-page anchors should not be numbered: %q", out)
	}
}

func TestListsQuotesCode(t *testing.T) {
	out, _ := plain(t, `<p>Intro</p><ul><li>one</li><li>two<ol><li>nested</li></ol></li></ul>
		<blockquote><p>quoted words</p></blockquote><pre>func main() {
	x := 1
}</pre><p>after</p>`, 60)
	for _, want := range []string{"• one\n• two\n  1. nested\n", "┃ quoted words", "func main() {\n    x := 1\n}", "\nafter\n"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
}

func TestSkipsScriptsAndShowsImages(t *testing.T) {
	out, _ := plain(t, `<script>alert(1)</script><p>Text <img src="a.png" alt="A cat"></p><style>p{}</style>`, 40)
	if strings.Contains(out, "alert") || strings.Contains(out, "p{}") {
		t.Errorf("script/style leaked: %q", out)
	}
	if !strings.Contains(out, "▣ A cat") {
		t.Errorf("image placeholder missing: %q", out)
	}
}

func TestPlainTextKeepsParagraphs(t *testing.T) {
	out, _ := plain(t, "First para\nstill first.\n\nSecond &amp; last.", 40)
	if out != "First para still first.\n\nSecond & last.\n" {
		t.Errorf("got %q", out)
	}
}

func TestReadingMinutes(t *testing.T) {
	if ReadingMinutes("") != 1 || ReadingMinutes(strings.Repeat("w ", 1000)) != 4 {
		t.Error("unexpected reading time")
	}
}
