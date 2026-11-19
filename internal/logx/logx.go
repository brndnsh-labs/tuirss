// Package logx sends slog output to a file, since the TUI owns the terminal.
package logx

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
)

// Setup points the default slog logger at path. Set TUIRSS_DEBUG=1 for debug logs.
func Setup(path string) (io.Closer, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	level := slog.LevelInfo
	if os.Getenv("TUIRSS_DEBUG") != "" {
		level = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(f, &slog.HandlerOptions{Level: level})))
	return f, nil
}
