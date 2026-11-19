// Package config loads and validates ~/.config/tuirss/config.toml.
package config

import (
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

// Duration is a time.Duration that reads from TOML strings like "30m".
type Duration struct{ time.Duration }

func (d *Duration) UnmarshalText(b []byte) error {
	v, err := time.ParseDuration(strings.TrimSpace(string(b)))
	if err != nil {
		return fmt.Errorf("invalid duration %q", b)
	}
	d.Duration = v
	return nil
}

func (d Duration) MarshalText() ([]byte, error) { return []byte(d.String()), nil }

type Config struct {
	// RefreshInterval is how often feeds refresh while tuirss is running.
	RefreshInterval Duration   `toml:"refresh_interval"`
	Local           Local      `toml:"local"`
	FreshRSS        []FreshRSS `toml:"freshrss"`
}

// Local configures feeds that tuirss fetches itself.
type Local struct {
	Enabled     bool     `toml:"enabled"`
	Concurrency int      `toml:"concurrency"`
	Timeout     Duration `toml:"timeout"`
}

// FreshRSS configures one FreshRSS account, synced over the Google Reader API.
type FreshRSS struct {
	Name     string `toml:"name"`
	URL      string `toml:"url"`
	Username string `toml:"username"`
	// PasswordCommand, if set, is run through `sh -c` and its first line of
	// output is used as the API password. Otherwise the system keyring is used.
	PasswordCommand string `toml:"password_command"`
}

func Default() Config {
	return Config{
		RefreshInterval: Duration{30 * time.Minute},
		Local: Local{
			Enabled:     true,
			Concurrency: 8,
			Timeout:     Duration{20 * time.Second},
		},
	}
}

// Load reads the config at path, layered over the defaults. A missing file is
// not an error: the defaults are returned.
func Load(path string) (Config, error) {
	cfg := Default()
	md, err := toml.DecodeFile(path, &cfg)
	if errors.Is(err, fs.ErrNotExist) {
		return cfg, nil
	}
	if err != nil {
		return cfg, fmt.Errorf("reading %s: %w", path, err)
	}
	if und := md.Undecoded(); len(und) > 0 {
		keys := make([]string, len(und))
		for i, k := range und {
			keys[i] = k.String()
		}
		return cfg, fmt.Errorf("%s: unknown setting(s): %s", path, strings.Join(keys, ", "))
	}
	if err := cfg.Validate(); err != nil {
		return cfg, fmt.Errorf("%s: %w", path, err)
	}
	return cfg, nil
}

func (c Config) Validate() error {
	var errs []error
	if c.RefreshInterval.Duration < time.Minute {
		errs = append(errs, errors.New("refresh_interval must be at least 1m"))
	}
	if c.Local.Concurrency < 1 || c.Local.Concurrency > 64 {
		errs = append(errs, errors.New("local.concurrency must be between 1 and 64"))
	}
	if c.Local.Timeout.Duration <= 0 {
		errs = append(errs, errors.New("local.timeout must be positive"))
	}
	seen := map[string]bool{}
	for i, f := range c.FreshRSS {
		where := fmt.Sprintf("freshrss[%d]", i)
		if f.Name != "" {
			where = fmt.Sprintf("freshrss %q", f.Name)
		}
		switch {
		case f.Name == "":
			errs = append(errs, fmt.Errorf("%s: name is required", where))
		case strings.EqualFold(f.Name, "local"):
			errs = append(errs, fmt.Errorf("%s: the name \"local\" is reserved", where))
		case seen[f.Name]:
			errs = append(errs, fmt.Errorf("%s: duplicate name", where))
		}
		seen[f.Name] = true
		if u, err := url.Parse(f.URL); err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
			errs = append(errs, fmt.Errorf("%s: url must be an http(s) address", where))
		}
		if f.Username == "" {
			errs = append(errs, fmt.Errorf("%s: username is required", where))
		}
	}
	return errors.Join(errs...)
}

// Example is written to the config path on first run.
const Example = `# tuirss configuration

# How often to refresh feeds while tuirss is running.
refresh_interval = "30m"

[local]
# Feeds tuirss fetches itself. Add them with ` + "`tuirss add <url>`" + ` or
# ` + "`tuirss import feeds.opml`" + `.
enabled = true
concurrency = 8
timeout = "20s"

# FreshRSS accounts sync over the Google Reader API. Create an API password
# in FreshRSS under Settings → Profile → API management.
#
# [[freshrss]]
# name = "Home"
# url = "https://freshrss.example.com"
# username = "me"
# Optional: a command that prints the API password. If unset, tuirss stores
# it in the system keyring when you run ` + "`tuirss login`" + `.
# password_command = "pass show freshrss"
`

// WriteExample writes Example to path unless a file already exists there.
func WriteExample(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, fs.ErrExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := f.WriteString(Example); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
