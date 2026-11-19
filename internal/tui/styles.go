package tui

import (
	"charm.land/lipgloss/v2"

	"github.com/brndnsh-labs/tuirss/internal/render"
)

// Colors are the terminal's own ANSI palette, so tuirss follows whatever theme
// the terminal uses (Omarchy themes foot, Alacritty, Ghostty, …).
var (
	cAccent = lipgloss.Color("4")
	cAlt    = lipgloss.Color("5")
	cMuted  = lipgloss.Color("8")
	cStar   = lipgloss.Color("3")
	cErr    = lipgloss.Color("1")
	cOK     = lipgloss.Color("2")
	cCode   = lipgloss.Color("6")
	cOnAcc  = lipgloss.Color("0")
)

type styles struct {
	logo, crumb, crumbSep, headerRight lipgloss.Style
	sep                                lipgloss.Style
	sideHead, sideItem, sideEmpty      lipgloss.Style
	sideSel, sideCount, sideErr        lipgloss.Style
	acct, acctActive, acctMark         lipgloss.Style
	bar, dot, star, fresh, freshTitle  lipgloss.Style
	titleUnread, titleRead, titleCur   lipgloss.Style
	meta, day                          lipgloss.Style
	rTitle, rMeta, rLink, rRule        lipgloss.Style
	status, key, ok, errMsg, spinner   lipgloss.Style
	box, boxTitle, boxKey, boxSel      lipgloss.Style
	muted, splash, splashLogo          lipgloss.Style
	render                             render.Styles
}

func newStyles() styles {
	n := lipgloss.NewStyle
	return styles{
		logo:        n().Background(cAccent).Foreground(cOnAcc).Bold(true).Padding(0, 1),
		crumb:       n().Bold(true),
		crumbSep:    n().Foreground(cMuted),
		headerRight: n().Foreground(cMuted),
		sep:         n().Foreground(cMuted),

		sideHead:  n().Foreground(cMuted).Bold(true),
		sideItem:  n(),
		sideEmpty: n().Foreground(cMuted),
		sideSel:   n().Foreground(cAccent).Bold(true),
		sideCount: n().Foreground(cMuted),
		sideErr:   n().Foreground(cErr),

		acct:       n().Foreground(cMuted),
		acctActive: n().Bold(true),
		acctMark:   n().Foreground(cAccent),

		bar:         n().Foreground(cAccent),
		dot:         n().Foreground(cAccent),
		star:        n().Foreground(cStar),
		fresh:       n().Foreground(cStar).Bold(true),
		freshTitle:  n().Foreground(cAccent).Bold(true),
		titleUnread: n(),
		titleRead:   n().Foreground(cMuted),
		titleCur:    n().Bold(true),
		meta:        n().Foreground(cMuted),
		day:         n().Foreground(cAlt).Bold(true),

		rTitle: n().Bold(true).Foreground(cAccent),
		rMeta:  n().Foreground(cMuted),
		rLink:  n().Foreground(cMuted).Underline(true),
		rRule:  n().Foreground(cMuted),

		status:  n().Foreground(cMuted),
		key:     n().Foreground(cAccent).Bold(true),
		ok:      n().Foreground(cOK),
		errMsg:  n().Foreground(cErr),
		spinner: n().Foreground(cAlt),

		box:      n().Border(lipgloss.RoundedBorder()).BorderForeground(cAccent).Padding(1, 2),
		boxTitle: n().Foreground(cAccent).Bold(true),
		boxKey:   n().Foreground(cAccent).Bold(true),
		boxSel:   n().Foreground(cAccent).Bold(true),

		muted:      n().Foreground(cMuted),
		splash:     n().Foreground(cMuted),
		splashLogo: n().Foreground(cAccent).Bold(true),

		render: render.Styles{
			Heading:   n().Bold(true).Foreground(cAccent),
			Link:      n().Foreground(cAccent).Underline(true),
			LinkRef:   n().Foreground(cMuted),
			Code:      n().Foreground(cCode),
			CodeBlock: n().Foreground(cCode),
			Quote:     n().Foreground(cAlt),
			Muted:     n().Foreground(cMuted),
			Bullet:    n().Foreground(cAccent),
		},
	}
}
