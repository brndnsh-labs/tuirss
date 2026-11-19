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

func TestImagePlacements(t *testing.T) {
	src := `<p>Before</p><p><a href="/big"><img src="/comic.png" alt="Comic"></a></p>` +
		`<img src="/pixel.gif"><p>Middle <img src="/loading.jpg" alt="Soon"> text</p><p>After</p>`
	fn := func(src, alt string) int {
		switch {
		case strings.HasSuffix(src, "comic.png"):
			return 4
		case strings.HasSuffix(src, "pixel.gif"):
			return -1
		}
		return 0
	}
	res := Render(src, 40, "https://x.example/post", Styles{}, fn)
	lines := strings.Split(ansi.Strip(res.Body), "\n")
	if len(res.Images) != 1 {
		t.Fatalf("placements = %+v", res.Images)
	}
	p := res.Images[0]
	if p.Src != "https://x.example/comic.png" || p.Rows != 4 || p.Alt != "Comic" {
		t.Errorf("placement = %+v", p)
	}
	for i := p.Line; i < p.Line+p.Rows; i++ {
		if strings.TrimSpace(lines[i]) != "" {
			t.Errorf("reserved line %d not blank: %q", i, lines[i])
		}
	}
	if lines[0] != "Before" || strings.TrimSpace(lines[p.Line-1]) != "" || strings.TrimSpace(lines[p.Line+p.Rows]) != "" {
		t.Errorf("image should sit between blank lines:\n%s", strings.Join(lines, "|\n"))
	}
	out := ansi.Strip(res.Body)
	if strings.Contains(out, "pixel") || !strings.Contains(out, "▣ Soon") {
		t.Errorf("hidden/placeholder images wrong:\n%s", out)
	}
	if !strings.Contains(out, "[1]") {
		t.Errorf("the link around the image should still be numbered:\n%s", out)
	}
}

func TestImageTitleCaption(t *testing.T) {
	xkcd := `<img src="https://imgs.xkcd.com/comics/voyager.png" title="The probe is fine; it's the rest of us." alt="Voyager Crash" />`
	out, _ := plain(t, xkcd, 60)
	if !strings.Contains(out, "▣ Voyager Crash") || !strings.Contains(out, "The probe is fine; it's the rest of us.") {
		t.Errorf("placeholder + caption expected:\n%s", out)
	}
	res := Render(xkcd, 60, "", Styles{}, func(string, string) int { return 3 })
	lines := strings.Split(ansi.Strip(res.Body), "\n")
	if len(res.Images) != 1 || !strings.Contains(lines[res.Images[0].Line+4], "The probe is fine") {
		t.Errorf("caption should follow the image after a blank line:\n%q", lines)
	}
}

func TestDrawnImageCaptionsEvenWhenTitleIsAlt(t *testing.T) {
	src := `<img src="/c.png" title="Same joke" alt="Same joke">`
	if out, _ := plain(t, src, 60); strings.Count(out, "Same joke") != 1 {
		t.Errorf("placeholder shouldn't repeat itself:\n%s", out)
	}
	res := Render(src, 60, "", Styles{}, func(string, string) int { return 2 })
	if !strings.Contains(ansi.Strip(res.Body), "Same joke") {
		t.Error("a drawn image hides its alt text, so the title should be the caption")
	}
}
