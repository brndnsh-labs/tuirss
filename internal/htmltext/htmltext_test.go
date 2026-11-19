package htmltext

import "testing"

func TestPlainText(t *testing.T) {
	for in, want := range map[string]string{
		"<p>Hello <b>world</b></p><p>again</p>": "Hello world again",
		"a<br>b":                                "a b",
		"<script>evil()</script><style>x{}</style>ok": "ok",
		"Tom &amp; Jerry":                   "Tom & Jerry",
		"  plain\n\ntext  ":                 "plain text",
		"<ul><li>one</li><li>two</li></ul>": "one two",
	} {
		if got := PlainText(in); got != want {
			t.Errorf("PlainText(%q) = %q, want %q", in, got, want)
		}
	}
	if got := Excerpt("<p>abcdef</p>", 3); got != "abc" {
		t.Errorf("Excerpt = %q", got)
	}
}
