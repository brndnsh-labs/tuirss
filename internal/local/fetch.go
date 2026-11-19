// Package local is the backend for feeds tuirss fetches itself.
package local

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/mmcdole/gofeed"
	"golang.org/x/net/html"
)

const (
	userAgent = "tuirss/0.1 (terminal RSS reader)"
	maxBytes  = 10 << 20 // 10 MiB
)

var ErrNotAFeed = errors.New("no RSS, Atom or JSON feed found at this address")

// Fetcher downloads and parses feeds, using conditional requests so unchanged
// feeds cost a 304 instead of a full download.
type Fetcher struct {
	Client *http.Client
}

func NewFetcher(timeout time.Duration) *Fetcher {
	return &Fetcher{Client: &http.Client{Timeout: timeout}}
}

type Response struct {
	URL          string // final URL after redirects
	NotModified  bool
	Feed         *gofeed.Feed
	ETag         string
	LastModified string
}

type page struct {
	url          *url.URL
	status       int
	contentType  string
	etag         string
	lastModified string
	body         []byte
}

func (f *Fetcher) get(ctx context.Context, rawURL, etag, lastModified string) (*page, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/rss+xml, application/atom+xml, application/feed+json, "+
		"application/xml;q=0.9, text/xml;q=0.9, application/json;q=0.8, text/html;q=0.5, */*;q=0.1")
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	if lastModified != "" {
		req.Header.Set("If-Modified-Since", lastModified)
	}
	resp, err := f.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	p := &page{
		url:          resp.Request.URL,
		status:       resp.StatusCode,
		contentType:  resp.Header.Get("Content-Type"),
		etag:         resp.Header.Get("ETag"),
		lastModified: resp.Header.Get("Last-Modified"),
	}
	if resp.StatusCode == http.StatusNotModified {
		return p, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return p, fmt.Errorf("server returned %s", resp.Status)
	}
	p.body, err = io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return p, err
	}
	if len(p.body) > maxBytes {
		return p, fmt.Errorf("feed is larger than %d MiB", maxBytes>>20)
	}
	return p, nil
}

// Fetch downloads and parses the feed at rawURL. Pass the stored validators to
// make the request conditional.
func (f *Fetcher) Fetch(ctx context.Context, rawURL, etag, lastModified string) (Response, error) {
	p, err := f.get(ctx, rawURL, etag, lastModified)
	if err != nil {
		return Response{}, err
	}
	resp := Response{URL: p.url.String(), ETag: p.etag, LastModified: p.lastModified}
	if p.status == http.StatusNotModified {
		resp.NotModified = true
		return resp, nil
	}
	resp.Feed, err = gofeed.NewParser().Parse(bytes.NewReader(p.body))
	if errors.Is(err, gofeed.ErrFeedTypeNotDetected) {
		return resp, ErrNotAFeed
	}
	if err != nil {
		return resp, fmt.Errorf("parsing feed: %w", err)
	}
	return resp, nil
}

// Discover fetches rawURL as a feed, or, if it's a web page, finds the feed it
// advertises with <link rel="alternate">.
func (f *Fetcher) Discover(ctx context.Context, rawURL string) (Response, error) {
	p, err := f.get(ctx, rawURL, "", "")
	if err != nil {
		return Response{}, err
	}
	feed, perr := gofeed.NewParser().Parse(bytes.NewReader(p.body))
	if perr == nil {
		return Response{URL: p.url.String(), Feed: feed, ETag: p.etag, LastModified: p.lastModified}, nil
	}
	links := feedLinks(p.body, p.url)
	if len(links) == 0 {
		if errors.Is(perr, gofeed.ErrFeedTypeNotDetected) {
			return Response{}, ErrNotAFeed
		}
		return Response{}, fmt.Errorf("parsing feed: %w", perr)
	}
	var firstErr error
	for _, link := range links {
		resp, err := f.Fetch(ctx, link, "", "")
		if err == nil {
			return resp, nil
		}
		if firstErr == nil {
			firstErr = fmt.Errorf("%s: %w", link, err)
		}
	}
	return Response{}, firstErr
}

var feedTypes = map[string]bool{
	"application/rss+xml":   true,
	"application/atom+xml":  true,
	"application/feed+json": true,
	"application/rdf+xml":   true,
	"application/json":      true,
	"application/xml":       true,
	"text/xml":              true,
}

// feedLinks returns the feed URLs an HTML page advertises, in page order.
func feedLinks(body []byte, base *url.URL) []string {
	var out []string
	seen := map[string]bool{}
	z := html.NewTokenizer(bytes.NewReader(body))
	for {
		switch z.Next() {
		case html.ErrorToken:
			return out
		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			if string(name) != "link" || !hasAttr {
				continue
			}
			var rel, typ, href string
			for {
				k, v, more := z.TagAttr()
				switch string(k) {
				case "rel":
					rel = strings.ToLower(string(v))
				case "type":
					typ = strings.ToLower(strings.TrimSpace(string(v)))
				case "href":
					href = strings.TrimSpace(string(v))
				}
				if !more {
					break
				}
			}
			if href == "" || !feedTypes[typ] || !hasToken(rel, "alternate") {
				continue
			}
			ref, err := base.Parse(href)
			if err != nil || (ref.Scheme != "http" && ref.Scheme != "https") {
				continue
			}
			if u := ref.String(); !seen[u] {
				seen[u] = true
				out = append(out, u)
			}
		}
	}
}

func hasToken(list, tok string) bool {
	for _, f := range strings.Fields(list) {
		if f == tok {
			return true
		}
	}
	return false
}

// NormalizeURL accepts what a person might type ("lwn.net", "https://…") and
// returns an absolute http(s) URL.
func NormalizeURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("empty URL")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("unsupported URL scheme %q", u.Scheme)
	}
	if u.Host == "" {
		return "", errors.New("URL has no host")
	}
	return u.String(), nil
}
