package main

import (
	"regexp"
	"runtime"
	"runtime/debug"
	"strings"
	"time"
)

// Set by GoReleaser at build time, e.g.
//
//	go build -ldflags "-X main.version=0.1.0 -X main.commit=abc123 -X main.date=2026-11-19T12:00:00Z"
//
// When they're empty, buildVersion falls back to what the Go toolchain
// recorded: the module version for `go install …@v0.1.0`, and the git commit
// for builds from a clone.
var (
	version = ""
	commit  = ""
	date    = ""
)

// pseudoVersion matches the versions Go makes up for untagged commits, like
// v0.0.0-20261119024319-ee89f4abe7de or v0.1.1-0.20261201…-abcdef123456.
var pseudoVersion = regexp.MustCompile(`\d{14}-[0-9a-f]{12}`)

type buildInfo struct {
	Version string
	Commit  string
	Date    string
	Dirty   bool // built from a clone with uncommitted changes
	Go      string
}

func currentBuild() buildInfo {
	b := buildInfo{Version: version, Commit: commit, Date: date, Go: runtime.Version()}
	if bi, ok := debug.ReadBuildInfo(); ok {
		if b.Version == "" && bi.Main.Version != "" && bi.Main.Version != "(devel)" {
			b.Version = bi.Main.Version
		}
		for _, s := range bi.Settings {
			switch s.Key {
			case "vcs.revision":
				if b.Commit == "" {
					b.Commit = s.Value
				}
			case "vcs.time":
				if b.Date == "" {
					b.Date = s.Value
				}
			case "vcs.modified":
				b.Dirty = s.Value == "true"
			}
		}
	}
	return b
}

// String renders e.g. "tuirss v0.1.0 (commit ee89f4a, 2026-11-19, go1.27.3)".
func (b buildInfo) String() string {
	v := b.Version
	switch {
	case v == "" || pseudoVersion.MatchString(v):
		v = "dev" // not a tagged release; the commit below says which build
	case v[0] >= '0' && v[0] <= '9':
		v = "v" + v // GoReleaser's version has no "v"; tags and go install do
	}
	var details []string
	if c := b.Commit; c != "" {
		if len(c) > 7 {
			c = c[:7]
		}
		if b.Dirty {
			c += "-dirty"
		}
		details = append(details, "commit "+c)
	}
	if b.Date != "" {
		if t, err := time.Parse(time.RFC3339, b.Date); err == nil {
			details = append(details, t.UTC().Format("2006-01-02"))
		} else {
			details = append(details, b.Date)
		}
	}
	if b.Go != "" {
		details = append(details, b.Go)
	}
	return "tuirss " + v + " (" + strings.Join(details, ", ") + ")"
}
