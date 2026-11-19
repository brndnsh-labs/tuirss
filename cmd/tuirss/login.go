package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"golang.org/x/term"

	"tuirss/internal/config"
	"tuirss/internal/freshrss"
)

func (a *app) freshrssConfig(args []string, verb string) (config.FreshRSS, error) {
	switch {
	case len(a.cfg.FreshRSS) == 0:
		return config.FreshRSS{}, errors.New("no FreshRSS accounts in the config yet: add a [[freshrss]] section (see the comments in config.toml)")
	case len(args) == 0 && len(a.cfg.FreshRSS) == 1:
		return a.cfg.FreshRSS[0], nil
	case len(args) == 1:
		for _, fc := range a.cfg.FreshRSS {
			if strings.EqualFold(fc.Name, args[0]) {
				return fc, nil
			}
		}
		return config.FreshRSS{}, fmt.Errorf("no FreshRSS account named %q in the config", args[0])
	default:
		var names []string
		for _, fc := range a.cfg.FreshRSS {
			names = append(names, fc.Name)
		}
		return config.FreshRSS{}, fmt.Errorf("usage: tuirss %s NAME (one of: %s)", verb, strings.Join(names, ", "))
	}
}

func cmdLogin(ctx context.Context, a *app, args []string) error {
	fc, err := a.freshrssConfig(args, "login")
	if err != nil {
		return err
	}
	src := freshrss.SecretFor(fc)
	if fc.PasswordCommand != "" {
		pw, err := src.Get(ctx)
		if err != nil {
			return err
		}
		fmt.Fprintf(a.out, "Checking %s as %s (password from password_command)…\n", fc.URL, fc.Username)
		if err := freshrss.Verify(ctx, fc, pw); err != nil {
			return err
		}
		fmt.Fprintln(a.out, "✓ Logged in. Run `tuirss` to start reading.")
		return nil
	}

	fmt.Fprintf(a.errw, "FreshRSS API password for %s at %s\n", fc.Username, fc.URL)
	fmt.Fprintln(a.errw, "(this is the API password from Settings → Profile → API management, not your login password)")
	pw, err := readPassword("Password: ")
	if err != nil {
		return err
	}
	if pw == "" {
		return errors.New("no password entered")
	}
	fmt.Fprintln(a.errw, "Checking…")
	if err := freshrss.Verify(ctx, fc, pw); err != nil {
		return err
	}
	if err := src.Set(pw); err != nil {
		return err
	}
	fmt.Fprintln(a.out, "✓ Logged in and saved to your keyring. Run `tuirss` to start reading.")
	return nil
}

func cmdLogout(ctx context.Context, a *app, args []string) error {
	fc, err := a.freshrssConfig(args, "logout")
	if err != nil {
		return err
	}
	if err := freshrss.SecretFor(fc).Delete(); err != nil {
		return err
	}
	fmt.Fprintf(a.out, "Forgot the saved password for %s.\n", fc.Name)
	return nil
}

func readPassword(prompt string) (string, error) {
	fmt.Fprint(os.Stderr, prompt)
	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		b, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		return strings.TrimSpace(string(b)), err
	}
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		return "", err
	}
	return strings.TrimSpace(line), nil
}
