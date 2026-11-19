// Package opml reads and writes OPML subscription lists.
package opml

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"golang.org/x/net/html/charset"
)

// Entry is one subscription. Folder is empty for top-level feeds.
type Entry struct {
	Title   string
	URL     string
	SiteURL string
	Folder  string
}

type document struct {
	XMLName xml.Name `xml:"opml"`
	Version string   `xml:"version,attr"`
	Head    struct {
		Title       string `xml:"title"`
		DateCreated string `xml:"dateCreated,omitempty"`
	} `xml:"head"`
	Body struct {
		Outlines []outline `xml:"outline"`
	} `xml:"body"`
}

type outline struct {
	Text     string    `xml:"text,attr"`
	Title    string    `xml:"title,attr,omitempty"`
	Type     string    `xml:"type,attr,omitempty"`
	XMLURL   string    `xml:"xmlUrl,attr,omitempty"`
	HTMLURL  string    `xml:"htmlUrl,attr,omitempty"`
	Outlines []outline `xml:"outline"`
}

// Parse reads subscriptions from OPML. Nested folders are flattened into their
// top-level folder, since tuirss (like FreshRSS) has one level of folders.
func Parse(r io.Reader) ([]Entry, error) {
	dec := xml.NewDecoder(r)
	dec.CharsetReader = charset.NewReaderLabel
	dec.Strict = false
	dec.Entity = xml.HTMLEntity
	var doc document
	if err := dec.Decode(&doc); err != nil {
		return nil, fmt.Errorf("parsing OPML: %w", err)
	}
	var out []Entry
	var walk func([]outline, string)
	walk = func(list []outline, folder string) {
		for _, o := range list {
			title := strings.TrimSpace(firstNonEmpty(o.Title, o.Text))
			if u := strings.TrimSpace(o.XMLURL); u != "" {
				out = append(out, Entry{Title: title, URL: u, SiteURL: strings.TrimSpace(o.HTMLURL), Folder: folder})
				continue
			}
			sub := folder
			if sub == "" {
				sub = title
			}
			walk(o.Outlines, sub)
		}
	}
	walk(doc.Body.Outlines, "")
	if len(out) == 0 {
		return nil, errors.New("no feeds found in OPML")
	}
	return out, nil
}

// Write emits entries as OPML 2.0, grouping them into folder outlines.
func Write(w io.Writer, title string, entries []Entry) error {
	var doc document
	doc.Version = "2.0"
	doc.Head.Title = title
	doc.Head.DateCreated = time.Now().Format(time.RFC1123Z)

	folderIndex := map[string]int{}
	for _, e := range entries {
		o := outline{Text: firstNonEmpty(e.Title, e.URL), Title: e.Title, Type: "rss", XMLURL: e.URL, HTMLURL: e.SiteURL}
		if e.Folder == "" {
			doc.Body.Outlines = append(doc.Body.Outlines, o)
			continue
		}
		i, ok := folderIndex[e.Folder]
		if !ok {
			i = len(doc.Body.Outlines)
			folderIndex[e.Folder] = i
			doc.Body.Outlines = append(doc.Body.Outlines, outline{Text: e.Folder, Title: e.Folder})
		}
		doc.Body.Outlines[i].Outlines = append(doc.Body.Outlines[i].Outlines, o)
	}

	if _, err := io.WriteString(w, xml.Header); err != nil {
		return err
	}
	enc := xml.NewEncoder(w)
	enc.Indent("", "  ")
	if err := enc.Encode(doc); err != nil {
		return err
	}
	_, err := io.WriteString(w, "\n")
	return err
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
