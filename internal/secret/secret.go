// Package secret finds account passwords: from a configured command, or from
// the system keyring (Secret Service on Linux, e.g. gnome-keyring).
package secret

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/zalando/go-keyring"
)

const service = "tuirss"

// ErrMissing means no password has been stored for the account yet.
var ErrMissing = errors.New("no password stored")

type Source struct {
	Account string // keyring key, e.g. "freshrss:Home"
	Command string // optional; run through sh -c
}

// Get returns the password, preferring Command when set.
func (s Source) Get(ctx context.Context) (string, error) {
	if s.Command != "" {
		ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		var stderr bytes.Buffer
		cmd := exec.CommandContext(ctx, "sh", "-c", s.Command)
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		if err != nil {
			msg := strings.TrimSpace(stderr.String())
			if msg != "" {
				return "", fmt.Errorf("password_command failed: %v: %s", err, msg)
			}
			return "", fmt.Errorf("password_command failed: %w", err)
		}
		pw, _, _ := strings.Cut(string(out), "\n")
		pw = strings.TrimRight(pw, "\r")
		if pw == "" {
			return "", errors.New("password_command printed nothing")
		}
		return pw, nil
	}
	pw, err := keyring.Get(service, s.Account)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", ErrMissing
	}
	if err != nil {
		return "", fmt.Errorf("reading keyring: %w", err)
	}
	return pw, nil
}

// Set stores the password in the keyring.
func (s Source) Set(password string) error {
	if err := keyring.Set(service, s.Account, password); err != nil {
		return fmt.Errorf("saving to keyring (is a Secret Service like gnome-keyring running? "+
			"otherwise set password_command in the config): %w", err)
	}
	return nil
}

// Delete removes the stored password, if any.
func (s Source) Delete() error {
	err := keyring.Delete(service, s.Account)
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
}
