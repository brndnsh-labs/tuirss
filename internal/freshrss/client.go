// Package freshrss syncs a FreshRSS account over its Google Reader–compatible
// API (https://freshrss.github.io/FreshRSS/en/developers/06_GoogleReader_API.html).
package freshrss

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	stateRead    = "user/-/state/com.google/read"
	stateStarred = "user/-/state/com.google/starred"
	readingList  = "user/-/state/com.google/reading-list"
	labelPrefix  = "user/-/label/"
	longIDPrefix = "tag:google.com,2005:reader/item/"
	userAgent    = "github.com/brndnsh-labs/tuirss/0.1 (terminal RSS reader)"
)

// ErrBadLogin means the server rejected the username or API password.
var ErrBadLogin = errors.New("FreshRSS rejected the username or API password")

// Client talks to one FreshRSS user's Google Reader API.
type Client struct {
	base     string // …/api/greader.php
	user     string
	password string
	http     *http.Client

	mu    sync.Mutex
	auth  string // ClientLogin token
	token string // short-lived write token (T)
}

// NewClient accepts the FreshRSS address (https://rss.example.com) or the full
// API address ending in greader.php.
func NewClient(serverURL, user, password string) *Client {
	base := strings.TrimRight(serverURL, "/")
	if !strings.HasSuffix(base, "greader.php") {
		base += "/api/greader.php"
	}
	return &Client{base: base, user: user, password: password, http: &http.Client{Timeout: 45 * time.Second}}
}

// Login exchanges the username and API password for an auth token.
func (c *Client) Login(ctx context.Context) error {
	form := url.Values{"Email": {c.user}, "Passwd": {c.password}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/accounts/ClientLogin", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", userAgent)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return ErrBadLogin
	case resp.StatusCode == http.StatusNotFound:
		return fmt.Errorf("no Google Reader API at %s (is the API enabled in FreshRSS under Settings → Authentication?)", c.base)
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("login: server returned %s: %s", resp.Status, snippet(body))
	}
	for _, line := range strings.Split(string(body), "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(line), "Auth="); ok && v != "" {
			c.mu.Lock()
			c.auth = v
			c.mu.Unlock()
			return nil
		}
	}
	return fmt.Errorf("login: unexpected response: %s", snippet(body))
}

func (c *Client) authToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	a := c.auth
	c.mu.Unlock()
	if a != "" {
		return a, nil
	}
	if err := c.Login(ctx); err != nil {
		return "", err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.auth, nil
}

func (c *Client) writeToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	t := c.token
	c.mu.Unlock()
	if t != "" {
		return t, nil
	}
	var body string
	if err := c.call(ctx, http.MethodGet, "/reader/api/0/token", nil, nil, &body); err != nil {
		return "", fmt.Errorf("getting write token: %w", err)
	}
	t = strings.TrimSpace(body)
	c.mu.Lock()
	c.token = t
	c.mu.Unlock()
	return t, nil
}

// call performs an authenticated request. With write set, it adds the write
// token to the form. Expired tokens are refreshed once.
func (c *Client) call(ctx context.Context, method, path string, query, form url.Values, out any) error {
	return c.callOpts(ctx, method, path, query, form, out, false)
}

func (c *Client) write(ctx context.Context, path string, form url.Values) error {
	var body string
	if err := c.callOpts(ctx, http.MethodPost, path, nil, form, &body, true); err != nil {
		return err
	}
	if b := strings.TrimSpace(body); b != "" && b != "OK" {
		return fmt.Errorf("%s: unexpected response %q", path, snippet([]byte(b)))
	}
	return nil
}

func (c *Client) callOpts(ctx context.Context, method, path string, query, form url.Values, out any, write bool) error {
	for attempt := 0; ; attempt++ {
		auth, err := c.authToken(ctx)
		if err != nil {
			return err
		}
		f := url.Values{}
		for k, v := range form {
			f[k] = v
		}
		if write {
			t, err := c.writeToken(ctx)
			if err != nil {
				return err
			}
			f.Set("T", t)
		}
		u := c.base + path
		if len(query) > 0 {
			u += "?" + query.Encode()
		}
		var reqBody io.Reader
		if method == http.MethodPost {
			reqBody = strings.NewReader(f.Encode())
		}
		req, err := http.NewRequestWithContext(ctx, method, u, reqBody)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "GoogleLogin auth="+auth)
		req.Header.Set("User-Agent", userAgent)
		if method == http.MethodPost {
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
		resp, err := c.http.Do(req)
		if err != nil {
			return err
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
		resp.Body.Close()
		if err != nil {
			return err
		}
		if resp.StatusCode == http.StatusUnauthorized && attempt == 0 {
			c.mu.Lock()
			if resp.Header.Get("X-Reader-Google-Bad-Token") == "true" {
				c.token = ""
			} else {
				c.auth, c.token = "", ""
			}
			c.mu.Unlock()
			continue
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return ErrBadLogin
		}
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			return fmt.Errorf("%s: server returned %s: %s", path, resp.Status, snippet(body))
		}
		switch o := out.(type) {
		case nil:
			return nil
		case *string:
			*o = string(body)
			return nil
		default:
			if err := json.Unmarshal(body, out); err != nil {
				return fmt.Errorf("%s: decoding response: %w", path, err)
			}
			return nil
		}
	}
}

func snippet(b []byte) string {
	s := strings.Join(strings.Fields(string(b)), " ")
	if len(s) > 200 {
		s = s[:200] + "…"
	}
	return s
}

// --- API types -------------------------------------------------------------

type Subscription struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	URL        string `json:"url"`
	HTMLURL    string `json:"htmlUrl"`
	Categories []struct {
		ID    string `json:"id"`
		Label string `json:"label"`
	} `json:"categories"`
}

// flexInt decodes numbers that servers send either as JSON numbers or strings.
type flexInt int64

func (f *flexInt) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		*f = 0
		return nil
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return err
	}
	*f = flexInt(n)
	return nil
}

type link struct {
	Href string `json:"href"`
}

type Item struct {
	ID            string   `json:"id"`
	Published     flexInt  `json:"published"`
	Updated       flexInt  `json:"updated"`
	TimestampUsec flexInt  `json:"timestampUsec"`
	Title         string   `json:"title"`
	Author        string   `json:"author"`
	Canonical     []link   `json:"canonical"`
	Alternate     []link   `json:"alternate"`
	Categories    []string `json:"categories"`
	Origin        struct {
		StreamID string `json:"streamId"`
		Title    string `json:"title"`
	} `json:"origin"`
	Summary struct {
		Content string `json:"content"`
	} `json:"summary"`
	Content struct {
		Content string `json:"content"`
	} `json:"content"`
}

func (it Item) has(tag string) bool {
	for _, c := range it.Categories {
		if c == tag {
			return true
		}
	}
	return false
}

// --- API calls -------------------------------------------------------------

func (c *Client) Subscriptions(ctx context.Context) ([]Subscription, error) {
	var out struct {
		Subscriptions []Subscription `json:"subscriptions"`
	}
	err := c.call(ctx, http.MethodGet, "/reader/api/0/subscription/list", url.Values{"output": {"json"}}, nil, &out)
	return out.Subscriptions, err
}

// ItemIDs lists every item id in stream (optionally excluding a state), as
// normalized long ids, newest first.
func (c *Client) ItemIDs(ctx context.Context, stream, exclude string) ([]string, error) {
	var ids []string
	cont := ""
	for page := 0; page < 50; page++ {
		q := url.Values{"s": {stream}, "n": {"10000"}, "output": {"json"}}
		if exclude != "" {
			q.Set("xt", exclude)
		}
		if cont != "" {
			q.Set("c", cont)
		}
		var out struct {
			ItemRefs []struct {
				ID string `json:"id"`
			} `json:"itemRefs"`
			Continuation string `json:"continuation"`
		}
		if err := c.call(ctx, http.MethodGet, "/reader/api/0/stream/items/ids", q, nil, &out); err != nil {
			return nil, err
		}
		for _, r := range out.ItemRefs {
			if id, ok := NormalizeID(r.ID); ok {
				ids = append(ids, id)
			}
		}
		if out.Continuation == "" || len(out.ItemRefs) == 0 {
			return ids, nil
		}
		cont = out.Continuation
	}
	return ids, nil
}

// Items fetches full items by id.
func (c *Client) Items(ctx context.Context, ids []string) ([]Item, error) {
	form := url.Values{}
	for _, id := range ids {
		form.Add("i", id)
	}
	var out struct {
		Items []Item `json:"items"`
	}
	err := c.call(ctx, http.MethodPost, "/reader/api/0/stream/items/contents", url.Values{"output": {"json"}}, form, &out)
	return out.Items, err
}

// EditTag adds or removes a state tag on items.
func (c *Client) EditTag(ctx context.Context, ids []string, add, remove string) error {
	form := url.Values{}
	for _, id := range ids {
		form.Add("i", id)
	}
	if add != "" {
		form.Set("a", add)
	}
	if remove != "" {
		form.Set("r", remove)
	}
	return c.write(ctx, "/reader/api/0/edit-tag", form)
}

// NormalizeID turns any Google Reader item id form (decimal, bare hex, or
// tag:google.com,2005:reader/item/<hex>) into the long form.
func NormalizeID(id string) (string, bool) {
	id = strings.TrimSpace(id)
	if hex, ok := strings.CutPrefix(id, longIDPrefix); ok {
		n, err := strconv.ParseUint(hex, 16, 64)
		if err != nil {
			return "", false
		}
		return fmt.Sprintf("%s%016x", longIDPrefix, n), true
	}
	n, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		return "", false
	}
	return fmt.Sprintf("%s%016x", longIDPrefix, n), true
}

// idValue orders ids; FreshRSS ids are microsecond timestamps.
func idValue(longID string) uint64 {
	n, _ := strconv.ParseUint(strings.TrimPrefix(longID, longIDPrefix), 16, 64)
	return n
}
