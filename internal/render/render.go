// Package render turns article HTML into styled, wrapped terminal text.
package render

import (
	"fmt"
	"net/url"
	"strings"
	"unicode"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

type Styles struct {
	Text      lipgloss.Style
	Heading   lipgloss.Style
	Link      lipgloss.Style
	LinkRef   lipgloss.Style // the [n] after a link
	Code      lipgloss.Style
	CodeBlock lipgloss.Style
	Quote     lipgloss.Style // the bar in front of blockquotes
	Muted     lipgloss.Style // images, captions, rules
	Bullet    lipgloss.Style
}

type Result struct {
	Body  string
	Links []string // numbered from 1, in reading order
}

// HTML renders src (an HTML fragment or plain text) at the given width.
// base resolves relative links and may be empty.
func HTML(src string, width int, base string, st Styles) Result {
	r := &renderer{st: st, width: max(width, 10), linkIndex: map[string]int{}}
	r.base, _ = url.Parse(base)
	if !strings.ContainsRune(src, '<') {
		// Plain text: keep paragraph breaks, which HTML parsing would collapse.
		for _, para := range strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n\n") {
			r.text(html.UnescapeString(para))
			r.flush()
			r.gap = true
		}
		return Result{Body: r.out.String(), Links: r.links}
	}
	doc, err := html.Parse(strings.NewReader(src))
	if err != nil {
		return Result{Body: src}
	}
	r.walk(doc)
	r.flush()
	return Result{Body: r.out.String(), Links: r.links}
}

type prefix struct {
	first, rest string // first line of the next block uses first, later lines rest
	used        bool
}

type renderer struct {
	st        Styles
	width     int
	base      *url.URL
	out       strings.Builder
	inline    strings.Builder
	spaced    bool // last inline output ended with whitespace (or nothing yet)
	style     lipgloss.Style
	prefixes  []*prefix
	pre       int
	gap       bool // a blank line is owed before the next block
	links     []string
	linkIndex map[string]int
	lists     []listState
}

type listState struct {
	ordered bool
	n       int
}

var skipped = map[atom.Atom]bool{
	atom.Script: true, atom.Style: true, atom.Noscript: true, atom.Template: true,
	atom.Head: true, atom.Svg: true, atom.Form: true, atom.Button: true, atom.Select: true,
}

func (r *renderer) walk(n *html.Node) {
	switch n.Type {
	case html.TextNode:
		if r.pre > 0 {
			r.inline.WriteString(r.st.CodeBlock.Render(n.Data))
		} else {
			r.text(n.Data)
		}
		return
	case html.ElementNode:
		if skipped[n.DataAtom] {
			return
		}
		if r.element(n) {
			return
		}
	}
	r.children(n)
}

func (r *renderer) children(n *html.Node) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		r.walk(c)
	}
}

// element renders n and reports whether it handled n's children itself.
func (r *renderer) element(n *html.Node) bool {
	saved := r.style
	defer func() { r.style = saved }()

	switch n.DataAtom {
	case atom.P, atom.Div, atom.Section, atom.Article, atom.Header, atom.Footer, atom.Main, atom.Aside, atom.Details, atom.Summary:
		r.block(func() { r.children(n) })
	case atom.Br:
		r.inline.WriteString("\n")
		r.spaced = true
	case atom.H1, atom.H2, atom.H3, atom.H4, atom.H5, atom.H6:
		r.block(func() {
			r.style = r.st.Heading
			if n.DataAtom == atom.H1 || n.DataAtom == atom.H2 {
				r.style = r.style.Underline(true)
			}
			r.children(n)
		})
	case atom.Strong, atom.B:
		r.style = r.style.Bold(true)
		r.children(n)
	case atom.Em, atom.I, atom.Cite:
		r.style = r.style.Italic(true)
		r.children(n)
	case atom.Del, atom.S, atom.Strike:
		r.style = r.style.Strikethrough(true)
		r.children(n)
	case atom.U, atom.Ins, atom.Mark:
		r.style = r.style.Underline(true)
		r.children(n)
	case atom.Code, atom.Kbd, atom.Samp, atom.Tt:
		if r.pre > 0 {
			r.children(n)
		} else {
			r.style = r.st.Code.Inherit(r.style)
			r.children(n)
		}
	case atom.A:
		raw := strings.TrimSpace(attr(n, "href"))
		href := r.resolve(raw)
		if raw == "" || strings.HasPrefix(raw, "#") || strings.HasPrefix(strings.ToLower(raw), "javascript:") {
			r.children(n)
			break
		}
		r.style = r.st.Link.Inherit(r.style).Hyperlink(href)
		before := r.inline.Len()
		r.children(n)
		if r.inline.Len() == before { // empty link text: show the host instead
			r.text(linkLabel(href))
		}
		r.style = saved
		r.inline.WriteString(r.st.LinkRef.Render(fmt.Sprintf("[%d]", r.link(href))))
		r.spaced = false
	case atom.Img:
		alt := strings.TrimSpace(attr(n, "alt"))
		if alt == "" {
			alt = "image"
		}
		r.space()
		r.inline.WriteString(r.st.Muted.Render("▣ " + alt))
		r.spaced = false
	case atom.Video, atom.Audio, atom.Iframe:
		src := r.resolve(attr(n, "src"))
		label := map[atom.Atom]string{atom.Video: "▶ video", atom.Audio: "♪ audio", atom.Iframe: "▣ embedded content"}[n.DataAtom]
		r.block(func() {
			r.inline.WriteString(r.st.Muted.Render(label))
			if src != "" {
				r.inline.WriteString(r.st.LinkRef.Render(fmt.Sprintf(" [%d]", r.link(src))))
			}
		})
	case atom.Hr:
		r.flush()
		r.gap = true
		r.emit(r.st.Muted.Render(strings.Repeat("─", min(r.width, 40))))
		r.gap = true
	case atom.Pre:
		r.block(func() {
			r.pre++
			r.children(n)
			r.pre--
		})
	case atom.Blockquote:
		r.flush()
		r.gap = true
		bar := r.st.Quote.Render("┃ ")
		r.prefixes = append(r.prefixes, &prefix{first: bar, rest: bar})
		r.style = r.style.Italic(true)
		r.children(n)
		r.flush()
		r.prefixes = r.prefixes[:len(r.prefixes)-1]
		r.gap = true
	case atom.Ul, atom.Ol, atom.Menu:
		r.flush()
		if len(r.lists) == 0 {
			r.gap = true
		}
		r.lists = append(r.lists, listState{ordered: n.DataAtom == atom.Ol})
		r.children(n)
		r.flush()
		r.lists = r.lists[:len(r.lists)-1]
		if len(r.lists) == 0 {
			r.gap = true
		}
	case atom.Li:
		r.flush()
		bullet := "• "
		if len(r.lists) > 0 {
			l := &r.lists[len(r.lists)-1]
			l.n++
			if l.ordered {
				bullet = fmt.Sprintf("%d. ", l.n)
			} else if len(r.lists) > 1 {
				bullet = "◦ "
			}
		}
		r.prefixes = append(r.prefixes, &prefix{first: r.st.Bullet.Render(bullet), rest: strings.Repeat(" ", ansi.StringWidth(bullet))})
		r.gap = false
		r.children(n)
		r.flush()
		r.prefixes = r.prefixes[:len(r.prefixes)-1]
	case atom.Dt:
		r.flush()
		r.style = r.style.Bold(true)
		r.children(n)
		r.flush()
	case atom.Dd:
		r.flush()
		r.prefixes = append(r.prefixes, &prefix{first: "    ", rest: "    "})
		r.children(n)
		r.flush()
		r.prefixes = r.prefixes[:len(r.prefixes)-1]
	case atom.Figure:
		r.block(func() { r.children(n) })
	case atom.Figcaption:
		r.flush()
		r.style = r.st.Muted.Italic(true)
		r.children(n)
		r.flush()
	case atom.Table:
		r.flush()
		r.gap = true
		r.children(n)
		r.flush()
		r.gap = true
	case atom.Tr:
		r.flush()
		first := true
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type != html.ElementNode || (c.DataAtom != atom.Td && c.DataAtom != atom.Th) {
				continue
			}
			if !first {
				r.inline.WriteString(r.st.Muted.Render(" │ "))
				r.spaced = true
			}
			first = false
			r.style = saved
			if c.DataAtom == atom.Th {
				r.style = r.style.Bold(true)
			}
			r.children(c)
		}
		r.flush()
	default:
		return false
	}
	return true
}

// block renders fn's output as its own paragraph, with blank lines around it.
func (r *renderer) block(fn func()) {
	r.flush()
	if len(r.prefixes) == 0 || !r.inList() {
		r.gap = true
	}
	fn()
	r.flush()
	if len(r.prefixes) == 0 || !r.inList() {
		r.gap = true
	}
}

func (r *renderer) inList() bool { return len(r.lists) > 0 }

// text appends inline text with HTML whitespace rules: runs collapse to one space.
func (r *renderer) text(s string) {
	if s == "" {
		return
	}
	lead := unicode.IsSpace([]rune(s)[0])
	trail := unicode.IsSpace([]rune(s)[len([]rune(s))-1])
	words := strings.Fields(s)
	if len(words) == 0 {
		if lead {
			r.space()
		}
		return
	}
	if lead {
		r.space()
	}
	r.inline.WriteString(r.style.Render(strings.Join(words, " ")))
	r.spaced = false
	if trail {
		r.space()
	}
}

func (r *renderer) space() {
	if !r.spaced && r.inline.Len() > 0 {
		r.inline.WriteByte(' ')
	}
	r.spaced = true
}

// flush wraps the pending inline text into a block.
func (r *renderer) flush() {
	text := r.inline.String()
	r.inline.Reset()
	r.spaced = true
	if r.pre == 0 {
		text = strings.Trim(text, " \n")
	} else {
		text = strings.Trim(text, "\n")
	}
	if strings.TrimSpace(ansi.Strip(text)) == "" {
		return
	}
	indent := 0
	for _, p := range r.prefixes {
		indent += ansi.StringWidth(p.rest)
	}
	w := max(r.width-indent, 10)
	var lines []string
	if r.pre > 0 {
		for _, l := range strings.Split(text, "\n") {
			lines = append(lines, strings.Split(ansi.Hardwrap(strings.ReplaceAll(l, "\t", "    "), w, true), "\n")...)
		}
	} else {
		lines = strings.Split(lipgloss.Wrap(text, w, "-/"), "\n")
	}
	for i := range lines {
		lines[i] = strings.TrimRight(lines[i], " ")
	}
	r.emit(lines...)
}

// emit writes finished lines, applying the prefix stack and any owed gap.
func (r *renderer) emit(lines ...string) {
	if r.gap && r.out.Len() > 0 {
		r.out.WriteString("\n")
	}
	r.gap = false
	for _, line := range lines {
		var p strings.Builder
		for _, pre := range r.prefixes {
			if pre.used {
				p.WriteString(pre.rest)
			} else {
				p.WriteString(pre.first)
			}
		}
		for _, pre := range r.prefixes {
			pre.used = true
		}
		r.out.WriteString(p.String())
		r.out.WriteString(line)
		r.out.WriteString("\n")
	}
}

func (r *renderer) link(href string) int {
	if i, ok := r.linkIndex[href]; ok {
		return i
	}
	r.links = append(r.links, href)
	r.linkIndex[href] = len(r.links)
	return len(r.links)
}

func (r *renderer) resolve(href string) string {
	href = strings.TrimSpace(href)
	if href == "" || r.base == nil {
		return href
	}
	u, err := r.base.Parse(href)
	if err != nil {
		return href
	}
	return u.String()
}

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

func linkLabel(href string) string {
	if u, err := url.Parse(href); err == nil && u.Host != "" {
		return u.Host
	}
	return "link"
}

// ReadingMinutes estimates reading time at ~230 words per minute (minimum 1).
func ReadingMinutes(plain string) int {
	return max(1, (len(strings.Fields(plain))+115)/230)
}
