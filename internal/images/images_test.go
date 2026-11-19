package images

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func checker(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if (x/8+y/8)%2 == 0 {
				img.Set(x, y, color.RGBA{200, 30, 30, 255})
			} else {
				img.Set(x, y, color.RGBA{240, 240, 240, 255})
			}
		}
	}
	return img
}

func TestLoadAndSixel(t *testing.T) {
	var gotReferer string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotReferer = r.Header.Get("Referer")
		switch r.URL.Path {
		case "/ok.png":
			png.Encode(w, checker(64, 48))
		case "/logo.svg":
			w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	c := NewCache(8)
	ctx := context.Background()

	if _, st := c.Info(srv.URL + "/ok.png"); st != Missing {
		t.Fatal("should start missing")
	}
	if err := c.Load(ctx, srv.URL+"/ok.png", "https://blog.example/post"); err != nil {
		t.Fatal(err)
	}
	if gotReferer != "https://blog.example/post" {
		t.Errorf("referer = %q", gotReferer)
	}
	info, st := c.Info(srv.URL + "/ok.png")
	if st != Ready || info != (Info{64, 48}) {
		t.Fatalf("info = %+v %v", info, st)
	}

	six := c.Sixel(srv.URL+"/ok.png", 32, 24, 0, 24)
	if !strings.HasPrefix(six, "\x1bP0;1;0q") && !strings.HasPrefix(six, "\x1bP0;1q") {
		t.Errorf("not a sixel DCS: %q", six[:min(len(six), 20)])
	}
	if !strings.HasSuffix(six, "\x1b\\") || !strings.Contains(six, `"1;1;32;24`) {
		t.Errorf("missing raster/terminator: %q…", six[:min(len(six), 40)])
	}
	crop := c.Sixel(srv.URL+"/ok.png", 32, 24, 6, 18)
	if !strings.Contains(crop, `"1;1;32;12`) {
		t.Errorf("crop should be 12px tall: %q…", crop[:min(len(crop), 40)])
	}
	if c.Sixel(srv.URL+"/ok.png", 32, 24, 0, 24) != six {
		t.Error("sixel should be cached")
	}

	for _, bad := range []string{"/logo.svg", "/missing.png"} {
		if err := c.Load(ctx, srv.URL+bad, ""); err == nil {
			t.Errorf("%s should fail", bad)
		}
		if _, st := c.Info(srv.URL + bad); st != Failed {
			t.Errorf("%s state = %v", bad, st)
		}
	}
	if c.Sixel(srv.URL+"/logo.svg", 10, 10, 0, 10) != "" {
		t.Error("failed image should have no sixel")
	}
}

func TestFitAndEviction(t *testing.T) {
	for _, tc := range []struct {
		in         Info
		maxW, maxH int
		w, h       int
	}{
		{Info{800, 600}, 400, 1000, 400, 300},   // shrink to width
		{Info{100, 50}, 400, 1000, 100, 50},     // never enlarge
		{Info{400, 4000}, 400, 1000, 100, 1000}, // tall: shrink to height
	} {
		if w, h := Fit(tc.in, tc.maxW, tc.maxH); w != tc.w || h != tc.h {
			t.Errorf("Fit(%v, %d, %d) = %d×%d, want %d×%d", tc.in, tc.maxW, tc.maxH, w, h, tc.w, tc.h)
		}
	}

	c := NewCache(2)
	for _, s := range []string{"a", "b", "c"} {
		c.Put(s, checker(4, 4), nil)
	}
	if _, st := c.Info("a"); st != Missing {
		t.Error("oldest entry should be evicted")
	}
	c.Put("huge", checker(4000, 100), nil)
	if info, _ := c.Info("huge"); info.W != maxDecodedW || info.H != 50 {
		t.Errorf("huge image should be shrunk on load: %+v", info)
	}
	var buf bytes.Buffer
	png.Encode(&buf, checker(2, 2))
}
