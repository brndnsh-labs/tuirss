package local

import (
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"strings"
	"time"

	"github.com/mmcdole/gofeed"

	"tuirss/internal/store"
)

// clockSkew is how far in the future a date may be before we treat it as bogus.
const clockSkew = time.Hour

// convertItems maps parsed feed items to store items. feedURL resolves
// relative links when the feed doesn't declare a site link.
func convertItems(feed *gofeed.Feed, feedURL string, now time.Time) []store.Item {
	base, _ := url.Parse(feedURL)
	if feed.Link != "" && base != nil {
		if site, err := base.Parse(feed.Link); err == nil {
			base = site
		}
	}
	out := make([]store.Item, 0, len(feed.Items))
	for _, it := range feed.Items {
		if it == nil {
			continue
		}
		link := resolve(base, strings.TrimSpace(it.Link))
		si := store.Item{
			GUID:    itemKey(it, link),
			URL:     link,
			Title:   strings.TrimSpace(it.Title),
			Author:  authors(it),
			Summary: it.Description,
			Content: it.Content,
		}
		switch {
		case it.PublishedParsed != nil:
			si.PublishedAt = *it.PublishedParsed
		case it.UpdatedParsed != nil:
			si.PublishedAt = *it.UpdatedParsed
		}
		if si.PublishedAt.After(now.Add(clockSkew)) {
			si.PublishedAt = now
		}
		if it.UpdatedParsed != nil {
			si.UpdatedAt = *it.UpdatedParsed
		}
		out = append(out, si)
	}
	return out
}

// itemKey picks a stable identity for an item: its GUID, else its link, else a
// hash of its content.
func itemKey(it *gofeed.Item, link string) string {
	if g := strings.TrimSpace(it.GUID); g != "" {
		return g
	}
	if link != "" {
		return link
	}
	h := sha256.Sum256([]byte(it.Title + "\x00" + it.Published + "\x00" + it.Description))
	return "sha256:" + hex.EncodeToString(h[:16])
}

func resolve(base *url.URL, link string) string {
	if link == "" || base == nil {
		return link
	}
	u, err := base.Parse(link)
	if err != nil {
		return link
	}
	return u.String()
}

func authors(it *gofeed.Item) string {
	var names []string
	for _, p := range it.Authors {
		if p == nil {
			continue
		}
		if n := strings.TrimSpace(p.Name); n != "" {
			names = append(names, n)
		} else if e := strings.TrimSpace(p.Email); e != "" {
			names = append(names, e)
		}
	}
	return strings.Join(names, ", ")
}
