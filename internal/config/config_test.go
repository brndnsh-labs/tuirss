package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func write(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestMissingFileUsesDefaults(t *testing.T) {
	cfg, err := Load(filepath.Join(t.TempDir(), "nope.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.RefreshInterval.Duration != 30*time.Minute || !cfg.Local.Enabled {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
}

func TestExampleParses(t *testing.T) {
	if _, err := Load(write(t, Example)); err != nil {
		t.Fatalf("example config should load: %v", err)
	}
}

func TestPartialOverridesKeepDefaults(t *testing.T) {
	cfg, err := Load(write(t, "[local]\nconcurrency = 2\n"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Local.Concurrency != 2 || cfg.Local.Timeout.Duration != 20*time.Second || !cfg.Local.Enabled {
		t.Fatalf("got %+v", cfg.Local)
	}
}

func TestUnknownKeyRejected(t *testing.T) {
	_, err := Load(write(t, "refersh_interval = \"5m\"\n"))
	if err == nil || !strings.Contains(err.Error(), "refersh_interval") {
		t.Fatalf("want unknown-key error, got %v", err)
	}
}

func TestFreshRSSValidation(t *testing.T) {
	_, err := Load(write(t, `
[[freshrss]]
name = "local"
url = "ftp://x"
`))
	if err == nil {
		t.Fatal("want error")
	}
	for _, want := range []string{"reserved", "url must be", "username is required"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q missing %q", err, want)
		}
	}

	cfg, err := Load(write(t, `
[[freshrss]]
name = "Home"
url = "https://rss.example.com"
username = "me"
`))
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.FreshRSS) != 1 || cfg.FreshRSS[0].Name != "Home" {
		t.Fatalf("got %+v", cfg.FreshRSS)
	}
}
