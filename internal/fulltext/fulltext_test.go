package fulltext

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const page = `<!doctype html><html><head><title>Big News | Site</title></head><body>
<nav><a href="/">Home</a> <a href="/about">About</a> <a href="/subscribe">Subscribe now!</a></nav>
<div class="sidebar ad">Buy things. Advertisement.</div>
<article>
  <h1>Big News</h1>
  <p>The first paragraph of the article explains what happened in considerable detail,
  with enough words that a readability scorer is confident this is the main content.</p>
  <p>A second paragraph continues the story, adding context, quotes, and the kind of
  sentences, with commas, that real articles have. <a href="/related">Related story</a>.</p>
  <p>Finally, a third paragraph wraps things up and gives the reader something to think
  about, which is what good journalism does, more or less, on most days of the week.</p>
  <img src="/photo.jpg" alt="A photo">
</article>
<footer>Copyright 2026 · Privacy · Terms</footer>
</body></html>`

func TestExtract(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/story":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, page)
		case "/file.pdf":
			w.Header().Set("Content-Type", "application/pdf")
			fmt.Fprint(w, "%PDF")
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	e := New()
	ctx := context.Background()

	got, err := e.Extract(ctx, srv.URL+"/story")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"first paragraph", "third paragraph", srv.URL + "/related", srv.URL + "/photo.jpg"} {
		if !strings.Contains(got, want) {
			t.Errorf("extracted HTML missing %q:\n%s", want, got)
		}
	}
	for _, junk := range []string{"Subscribe now", "Privacy"} {
		if strings.Contains(got, junk) {
			t.Errorf("extracted HTML kept %q", junk)
		}
	}

	if _, err := e.Extract(ctx, srv.URL+"/file.pdf"); err == nil || !strings.Contains(err.Error(), "not a web page") {
		t.Errorf("pdf: %v", err)
	}
	if _, err := e.Extract(ctx, srv.URL+"/missing"); err == nil || !strings.Contains(err.Error(), "404") {
		t.Errorf("404: %v", err)
	}
	if _, err := e.Extract(ctx, "mailto:x@example.com"); err == nil {
		t.Error("mailto should fail")
	}
}
