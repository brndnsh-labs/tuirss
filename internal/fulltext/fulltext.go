// Package fulltext downloads an article's web page and extracts its main
// content, for feeds that only publish summaries.
package fulltext

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"

	readability "codeberg.org/readeck/go-readability/v2"
	"golang.org/x/net/html/charset"
)

const (
	maxBytes = 8 << 20
	// A browser-like user agent: some sites serve bots an empty shell.
	userAgent = "Mozilla/5.0 (X11; Linux x86_64) tuirss/0.1 (terminal RSS reader)"
)

var ErrNoContent = errors.New("couldn't find the article text on that page")

type Extractor struct {
	Client *http.Client
}

func New() *Extractor {
	return &Extractor{Client: &http.Client{Timeout: 25 * time.Second}}
}

// Extract fetches pageURL and returns the cleaned-up HTML of its main content.
func (e *Extractor) Extract(ctx context.Context, pageURL string) (string, error) {
	u, err := url.Parse(pageURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "", fmt.Errorf("can't fetch %q", pageURL)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
	resp, err := e.Client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("the site returned %s", resp.Status)
	}
	ct := resp.Header.Get("Content-Type")
	if mt, _, err := mime.ParseMediaType(ct); err == nil && !strings.Contains(mt, "html") {
		return "", fmt.Errorf("that link is %s, not a web page", mt)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes))
	if err != nil {
		return "", err
	}
	return extractHTML(body, ct, resp.Request.URL)
}

func extractHTML(body []byte, contentType string, page *url.URL) (string, error) {
	r, err := charset.NewReader(bytes.NewReader(body), contentType)
	if err != nil {
		r = bytes.NewReader(body)
	}
	art, err := readability.FromReader(r, page)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrNoContent, err)
	}
	var out strings.Builder
	if err := art.RenderHTML(&out); err != nil {
		return "", err
	}
	if strings.TrimSpace(out.String()) == "" {
		return "", ErrNoContent
	}
	return out.String(), nil
}
