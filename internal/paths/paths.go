// Package paths resolves tuirss's files using the XDG base directory spec.
package paths

import (
	"os"
	"path/filepath"
)

const app = "tuirss"

func dir(env string, fallback ...string) string {
	if v := os.Getenv(env); v != "" && filepath.IsAbs(v) {
		return filepath.Join(v, app)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(append(append([]string{home}, fallback...), app)...)
}

// ConfigDir is where config.toml lives (~/.config/tuirss).
func ConfigDir() string { return dir("XDG_CONFIG_HOME", ".config") }

// DataDir holds the database (~/.local/share/tuirss).
func DataDir() string { return dir("XDG_DATA_HOME", ".local", "share") }

// StateDir holds logs and other disposable state (~/.local/state/tuirss).
func StateDir() string { return dir("XDG_STATE_HOME", ".local", "state") }

func ConfigFile() string { return filepath.Join(ConfigDir(), "config.toml") }
func DBFile() string     { return filepath.Join(DataDir(), "tuirss.db") }
func LogFile() string    { return filepath.Join(StateDir(), "tuirss.log") }
