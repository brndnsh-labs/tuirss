// Package htmltext extracts readable plain text from HTML fragments, for
// search indexing and list excerpts.
package htmltext

import (
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

var skip = map[atom.Atom]bool{
	atom.Script: true, atom.Style: true, atom.Noscript: true, atom.Template: true,
	atom.Svg: true, atom.Iframe: true, atom.Head: true,
}

var block = map[atom.Atom]bool{
	atom.P: true, atom.Div: true, atom.Br: true, atom.Li: true, atom.Tr: true,
	atom.H1: true, atom.H2: true, atom.H3: true, atom.H4: true, atom.H5: true, atom.H6: true,
	atom.Blockquote: true, atom.Pre: true, atom.Section: true, atom.Article: true,
	atom.Td: true, atom.Th: true, atom.Figcaption: true, atom.Dd: true, atom.Dt: true,
}

// PlainText returns the visible text of an HTML fragment with whitespace
// collapsed to single spaces. Plain-text input passes through (collapsed).
func PlainText(src string) string {
	if !strings.ContainsAny(src, "<&") {
		return strings.Join(strings.Fields(src), " ")
	}
	var b strings.Builder
	z := html.NewTokenizer(strings.NewReader(src))
	depth := 0 // inside skipped elements
	for {
		switch z.Next() {
		case html.ErrorToken:
			return strings.Join(strings.Fields(b.String()), " ")
		case html.TextToken:
			if depth == 0 {
				b.Write(z.Text())
			}
		case html.StartTagToken:
			name, _ := z.TagName()
			a := atom.Lookup(name)
			if skip[a] {
				depth++
			} else if block[a] {
				b.WriteByte(' ')
			}
		case html.EndTagToken:
			name, _ := z.TagName()
			a := atom.Lookup(name)
			if skip[a] && depth > 0 {
				depth--
			} else if block[a] {
				b.WriteByte(' ')
			}
		case html.SelfClosingTagToken:
			name, _ := z.TagName()
			if block[atom.Lookup(name)] {
				b.WriteByte(' ')
			}
		}
	}
}

// Excerpt returns up to n runes of PlainText(src).
func Excerpt(src string, n int) string {
	t := []rune(PlainText(src))
	if len(t) <= n {
		return string(t)
	}
	return string(t[:n])
}
