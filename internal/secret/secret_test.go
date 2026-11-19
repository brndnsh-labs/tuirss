package secret

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"
)

func TestCommand(t *testing.T) {
	ctx := context.Background()
	pw, err := Source{Command: "printf 'hunter2\\nsecond line\\n'"}.Get(ctx)
	if err != nil || pw != "hunter2" {
		t.Errorf("got %q, %v", pw, err)
	}
	if _, err := (Source{Command: "true"}).Get(ctx); err == nil {
		t.Error("empty output should fail")
	}
	if _, err := (Source{Command: "echo nope >&2; exit 3"}).Get(ctx); err == nil || !strings.Contains(err.Error(), "nope") {
		t.Errorf("want stderr in error, got %v", err)
	}
}

func TestKeyring(t *testing.T) {
	keyring.MockInit()
	s := Source{Account: "freshrss:test"}
	if _, err := s.Get(context.Background()); !errors.Is(err, ErrMissing) {
		t.Fatalf("want ErrMissing, got %v", err)
	}
	if err := s.Set("pw"); err != nil {
		t.Fatal(err)
	}
	if pw, err := s.Get(context.Background()); err != nil || pw != "pw" {
		t.Fatalf("got %q, %v", pw, err)
	}
	if err := s.Delete(); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(); err != nil {
		t.Fatalf("deleting twice should be fine: %v", err)
	}
}
