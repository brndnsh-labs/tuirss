package opml

import (
	"bytes"
	"reflect"
	"strings"
	"testing"
)

const sample = `<?xml version="1.0" encoding="ISO-8859-1"?>
<opml version="1.0">
  <head><title>Subs &amp; things</title></head>
  <body>
    <outline text="Top" xmlUrl="https://top.example/feed"/>
    <outline text="Tech" title="Tech">
      <outline text="LWN" type="rss" xmlUrl=" https://lwn.net/headlines/rss " htmlUrl="https://lwn.net"/>
      <outline text="Deep">
        <outline title="Nested" text="ignored" xmlUrl="https://nested.example/atom"/>
      </outline>
    </outline>
    <outline text="Empty folder"/>
  </body>
</opml>`

func TestParse(t *testing.T) {
	got, err := Parse(strings.NewReader(sample))
	if err != nil {
		t.Fatal(err)
	}
	want := []Entry{
		{Title: "Top", URL: "https://top.example/feed"},
		{Title: "LWN", URL: "https://lwn.net/headlines/rss", SiteURL: "https://lwn.net", Folder: "Tech"},
		{Title: "Nested", URL: "https://nested.example/atom", Folder: "Tech"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %+v\nwant %+v", got, want)
	}
}

func TestRoundTrip(t *testing.T) {
	in := []Entry{
		{Title: "A", URL: "https://a.example/feed", Folder: "One"},
		{Title: "B", URL: "https://b.example/feed"},
		{Title: "C & D", URL: "https://c.example/feed?x=1&y=2", Folder: "One"},
	}
	var buf bytes.Buffer
	if err := Write(&buf, "test", in); err != nil {
		t.Fatal(err)
	}
	out, err := Parse(&buf)
	if err != nil {
		t.Fatal(err)
	}
	// Write groups folders, so C moves next to A.
	want := []Entry{in[0], in[2], in[1]}
	if !reflect.DeepEqual(out, want) {
		t.Fatalf("got  %+v\nwant %+v", out, want)
	}
}

func TestParseEmpty(t *testing.T) {
	if _, err := Parse(strings.NewReader(`<opml><body/></opml>`)); err == nil {
		t.Fatal("want error for OPML with no feeds")
	}
}
