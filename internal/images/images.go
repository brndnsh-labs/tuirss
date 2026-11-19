// Package images downloads article images and encodes them as sixel
// graphics for terminals that support it (foot, WezTerm, recent xterm, …).
package images

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/charmbracelet/x/ansi"
	"github.com/charmbracelet/x/ansi/sixel"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	maxDownload = 15 << 20
	maxDecodedW = 2000 // larger images are shrunk on load to bound memory
	userAgent   = "Mozilla/5.0 (X11; Linux x86_64) tuirss/0.1 (terminal RSS reader)"
)

type State int

const (
	Missing State = iota // never requested
	Ready
	Failed
)

type Info struct{ W, H int }

// Cache holds decoded images, their scaled copies, and encoded sixel crops.
// It's safe for concurrent use.
type Cache struct {
	Client *http.Client

	mu      sync.Mutex
	entries map[string]*entry
	order   []string // insertion order, for eviction
	max     int
	sixels  map[sixelKey]string
	sixOrd  []sixelKey
}

type entry struct {
	img    image.Image
	err    error
	scaled map[[2]int]*image.RGBA
}

type sixelKey struct {
	src          string
	w, h, y0, y1 int
}

func NewCache(max int) *Cache {
	return &Cache{
		Client:  &http.Client{Timeout: 20 * time.Second},
		entries: map[string]*entry{},
		max:     max,
		sixels:  map[sixelKey]string{},
	}
}

// Info reports an image's natural size, if it has been loaded.
func (c *Cache) Info(src string) (Info, State) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[src]
	switch {
	case !ok:
		return Info{}, Missing
	case e.err != nil:
		return Info{}, Failed
	}
	b := e.img.Bounds()
	return Info{b.Dx(), b.Dy()}, Ready
}

// Put stores an image directly (used by tests and for already-decoded data).
func (c *Cache) Put(src string, img image.Image, err error) {
	if img != nil && img.Bounds().Dx() > maxDecodedW {
		b := img.Bounds()
		img = scale(img, maxDecodedW, b.Dy()*maxDecodedW/b.Dx())
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.entries[src]; !ok {
		c.order = append(c.order, src)
	}
	c.entries[src] = &entry{img: img, err: err, scaled: map[[2]int]*image.RGBA{}}
	for len(c.order) > c.max {
		old := c.order[0]
		c.order = c.order[1:]
		delete(c.entries, old)
	}
}

// Load downloads and decodes src. referer is sent because some sites refuse
// hotlinked images without one.
func (c *Cache) Load(ctx context.Context, src, referer string) error {
	img, err := c.fetch(ctx, src, referer)
	if ctx.Err() != nil {
		return ctx.Err() // don't cache cancellations as failures
	}
	c.Put(src, img, err)
	return err
}

func (c *Cache) fetch(ctx context.Context, src, referer string) (image.Image, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, src, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "image/png,image/jpeg,image/gif,image/webp;q=0.9,*/*;q=0.1")
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	resp, err := c.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("image: %s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxDownload+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxDownload {
		return nil, errors.New("image too large")
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decoding image: %w", err) // e.g. SVG, AVIF
	}
	return img, nil
}

// Fit scales a w×h image down (never up) to fit within maxW×maxH.
func Fit(in Info, maxW, maxH int) (int, int) {
	if in.W <= 0 || in.H <= 0 {
		return 0, 0
	}
	s := min(1, float64(maxW)/float64(in.W), float64(maxH)/float64(in.H))
	return max(int(float64(in.W)*s), 1), max(int(float64(in.H)*s), 1)
}

func scale(img image.Image, w, h int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Src, nil)
	return dst
}

// Sixel returns a complete sixel escape sequence for rows y0..y1 (in scaled
// pixels) of src scaled to w×h. It returns "" if the image isn't loaded.
func (c *Cache) Sixel(src string, w, h, y0, y1 int) string {
	key := sixelKey{src, w, h, y0, y1}
	c.mu.Lock()
	if s, ok := c.sixels[key]; ok {
		c.mu.Unlock()
		return s
	}
	e, ok := c.entries[src]
	if !ok || e.err != nil {
		c.mu.Unlock()
		return ""
	}
	scaled := e.scaled[[2]int{w, h}]
	img := e.img
	c.mu.Unlock()

	if scaled == nil {
		scaled = scale(img, w, h)
		c.mu.Lock()
		e.scaled[[2]int{w, h}] = scaled
		c.mu.Unlock()
	}
	y0, y1 = max(y0, 0), min(y1, h)
	if y1 <= y0 {
		return ""
	}
	var buf bytes.Buffer
	if err := (&sixel.Encoder{}).Encode(&buf, scaled.SubImage(image.Rect(0, y0, w, y1))); err != nil {
		return ""
	}
	out := ansi.SixelGraphics(0, 1, 0, buf.Bytes())

	c.mu.Lock()
	defer c.mu.Unlock()
	c.sixels[key] = out
	c.sixOrd = append(c.sixOrd, key)
	for len(c.sixOrd) > 48 {
		delete(c.sixels, c.sixOrd[0])
		c.sixOrd = c.sixOrd[1:]
	}
	return out
}
