package main

import "testing"

func TestVersionString(t *testing.T) {
	for _, tc := range []struct {
		b    buildInfo
		want string
	}{
		{ // GoReleaser build
			buildInfo{Version: "0.1.0", Commit: "ee89f4a1c2d3", Date: "2026-11-19T02:32:11Z", Go: "go1.27.3"},
			"tuirss v0.1.0 (commit ee89f4a, 2026-11-19, go1.27.3)",
		},
		{ // go install …@v0.2.0
			buildInfo{Version: "v0.2.0", Go: "go1.27.3"},
			"tuirss v0.2.0 (go1.27.3)",
		},
		{ // go build in a clone with uncommitted edits
			buildInfo{Version: "v0.0.0-20261119024319-ee89f4abe7de+dirty", Commit: "ee89f4a1c2d3", Date: "2026-11-19T02:32:11Z", Dirty: true, Go: "go1.27.3"},
			"tuirss dev (commit ee89f4a-dirty, 2026-11-19, go1.27.3)",
		},
	} {
		if got := tc.b.String(); got != tc.want {
			t.Errorf("got  %q\nwant %q", got, tc.want)
		}
	}
}

func TestVersionCommandNeedsNoSetup(t *testing.T) {
	// `tuirss version` must work without a config or database, so pointing
	// at files that don't exist must not matter.
	if code := run([]string{"-config", "/nonexistent/config.toml", "-db", "/nonexistent/x.db", "version"}); code != 0 {
		t.Errorf("version exit code = %d", code)
	}
	if code := run([]string{"--version"}); code != 0 {
		t.Errorf("--version exit code = %d", code)
	}
}
