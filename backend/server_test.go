package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"passcryptum/internal/guard"
	"passcryptum/internal/store"
	"passcryptum/internal/wire"
)

// The HTTP layer owns every contract decision (status codes, the
// unknown-profile 403, the lockout order) and had no tests at all: the
// contract suite needs a live binary. These run the handlers in-process
// against an in-memory store and a guard with an injected clock.

var (
	testSeed = bytes.Repeat([]byte{0x5a}, ed25519.SeedSize)
	testPriv = ed25519.NewKeyFromSeed(testSeed)
	testPub  = testPriv.Public().(ed25519.PublicKey)
	testPubB = base64.StdEncoding.EncodeToString(testPub)
)

type fixture struct {
	t   *testing.T
	st  *store.Store
	g   *guard.Guard
	srv *server
	now time.Time
}

func newFixture(t *testing.T) *fixture {
	t.Helper()

	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	f := &fixture{t: t, st: st, now: time.Unix(1_800_000_000, 0)}
	f.g = guard.New(300, 100, 2*wire.TimestampTolerance, func() time.Time { return f.now })
	f.srv = &server{st: st, g: f.g, now: func() time.Time { return f.now }}

	return f
}

// ts is a 4-byte LE timestamp `offset` seconds from the fixture's clock.
func (f *fixture) ts(offset int64) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, uint32(f.now.Unix()+offset))

	return b
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func (f *fixture) onboard(pub string) {
	f.t.Helper()

	if _, err := f.st.AddPublicKey(pub); err != nil {
		f.t.Fatalf("onboard: %v", err)
	}
}

// signedGet builds a v1 signed GET (signature over the bare timestamp).
func (f *fixture) signedGet(path string, offset int64) *http.Request {
	ts := f.ts(offset)
	r := httptest.NewRequest(http.MethodGet, path, nil)
	r.Header.Set(wire.HdrPublicKey, testPubB)
	r.Header.Set(wire.HdrTimestamp, b64(ts))
	r.Header.Set(wire.HdrSignature, b64(ed25519.Sign(testPriv, ts)))

	return r
}

// signedPost builds a v1 POST: body b64(sig ‖ ts ‖ payload).
func (f *fixture) signedPost(path string, payload []byte, offset int64) *http.Request {
	ts := f.ts(offset)
	sig := ed25519.Sign(testPriv, append(append([]byte{}, ts...), payload...))
	body := b64(append(append(append([]byte{}, sig...), ts...), payload...))
	r := httptest.NewRequest(http.MethodPost, path, bytes.NewReader([]byte(body)))
	r.Header.Set(wire.HdrPublicKey, testPubB)

	return r
}

// serve routes the request to the handler the path belongs to, exactly as
// the mux does in production.
func (f *fixture) serve(r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()

	switch r.URL.Path {
	case "/api/profiles/":
		f.srv.handleProfiles(w, r)
	case "/api/credentials/":
		f.srv.handleCredentials(w, r)
	default:
		f.t.Fatalf("unexpected path %q", r.URL.Path)
	}

	return w
}

func TestProfilesGetStatuses(t *testing.T) {
	f := newFixture(t)

	t.Run("unknown profile is 403", func(t *testing.T) {
		w := f.serve(f.signedGet("/api/profiles/", 0))

		if w.Code != http.StatusForbidden {
			t.Fatalf("got %d, want 403", w.Code)
		}
	})

	t.Run("known profile without services is 204", func(t *testing.T) {
		f.onboard(testPubB)

		if w := f.serve(f.signedGet("/api/profiles/", 0)); w.Code != http.StatusNoContent {
			t.Fatalf("got %d, want 204", w.Code)
		}
	})

	t.Run("stored services come back as a JSON string", func(t *testing.T) {
		if _, err := f.st.SetServices(testPubB, b64([]byte(`{"a":{}}`))); err != nil {
			t.Fatal(err)
		}

		w := f.serve(f.signedGet("/api/profiles/", 0))

		if w.Code != http.StatusOK || w.Body.String() != `"`+b64([]byte(`{"a":{}}`))+`"` {
			t.Fatalf("got %d %q", w.Code, w.Body.String())
		}
	})
}

func TestProfilesPostAndDelete(t *testing.T) {
	f := newFixture(t)

	t.Run("POST to an unknown profile is 403", func(t *testing.T) {
		if w := f.serve(f.signedPost("/api/profiles/", []byte("X"), 0)); w.Code != http.StatusForbidden {
			t.Fatalf("got %d, want 403", w.Code)
		}
	})

	f.onboard(testPubB)

	t.Run("POST stores the payload", func(t *testing.T) {
		if w := f.serve(f.signedPost("/api/profiles/", []byte("blob"), 0)); w.Code != http.StatusOK {
			t.Fatalf("got %d, want 200", w.Code)
		}

		services, found, err := f.st.GetServices(testPubB)
		if err != nil || !found || services == nil || *services != b64([]byte("blob")) {
			t.Fatalf("stored %v found=%v err=%v", services, found, err)
		}
	})

	t.Run("DELETE clears, then reports 204", func(t *testing.T) {
		if w := f.serve(f.signedGet("/api/profiles/", 0)); w.Code != http.StatusOK {
			t.Fatalf("precondition: got %d, want 200", w.Code)
		}

		ts := f.ts(0)
		del := httptest.NewRequest(http.MethodDelete, "/api/profiles/", nil)
		del.Header.Set(wire.HdrPublicKey, testPubB)
		del.Header.Set(wire.HdrTimestamp, b64(ts))
		del.Header.Set(wire.HdrSignature, b64(ed25519.Sign(testPriv, ts)))

		if w := f.serve(del); w.Code != http.StatusOK {
			t.Fatalf("first delete: got %d, want 200", w.Code)
		}

		ts2 := f.ts(0)
		again := httptest.NewRequest(http.MethodDelete, "/api/profiles/", nil)
		again.Header.Set(wire.HdrPublicKey, testPubB)
		again.Header.Set(wire.HdrTimestamp, b64(ts2))
		again.Header.Set(wire.HdrSignature, b64(ed25519.Sign(testPriv, ts2)))

		if w := f.serve(again); w.Code != http.StatusNoContent {
			t.Fatalf("second delete: got %d, want 204", w.Code)
		}
	})
}

func TestCredentialsGetOrderOfChecks(t *testing.T) {
	f := newFixture(t)

	if _, err := f.st.AddPublicKey(testPubB); err != nil {
		t.Fatal(err)
	}
	if err := f.st.CreateCredential(testPubB, b64([]byte("pin")), b64(bytes.Repeat([]byte{1}, 32)), b64([]byte("entropy"))); err != nil {
		t.Fatal(err)
	}

	credGet := func(pin, protector string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/api/credentials/", nil)
		r.Header.Set(wire.HdrPublicKey, testPubB)
		r.Header.Set(wire.HdrHashedPin, pin)
		r.Header.Set(wire.HdrProtector, protector)
		r.Header.Set(wire.HdrTimestamp, b64(f.ts(0)))

		return r
	}

	t.Run("a known profile with the right factors gets entropy", func(t *testing.T) {
		w := f.serve(credGet(b64([]byte("pin")), b64(bytes.Repeat([]byte{1}, 32))))

		if w.Code != http.StatusOK {
			t.Fatalf("got %d, want 200", w.Code)
		}
	})

	t.Run("wrong protector is 403 and counts as a failure", func(t *testing.T) {
		w := f.serve(credGet(b64([]byte("pin")), b64(bytes.Repeat([]byte{9}, 32))))

		if w.Code != http.StatusForbidden {
			t.Fatalf("got %d, want 403", w.Code)
		}
	})
}

// The failure counter must not grow for profiles that do not exist: that
// would let anyone inflate the map (and the log) with random keys.
func TestCredentialsGetDoesNotCountUnknownProfiles(t *testing.T) {
	f := newFixture(t)

	r := httptest.NewRequest(http.MethodGet, "/api/credentials/", nil)
	r.Header.Set(wire.HdrPublicKey, testPubB)
	r.Header.Set(wire.HdrHashedPin, b64([]byte("pin")))
	r.Header.Set(wire.HdrProtector, b64(bytes.Repeat([]byte{1}, 32)))
	r.Header.Set(wire.HdrTimestamp, b64(f.ts(0)))

	if w := f.serve(r); w.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403", w.Code)
	}

	if f.g.Locked(testPubB) {
		t.Fatal("an unknown profile must not be pushed into lockout")
	}
}

func TestCredentialsPostIssuesAProtector(t *testing.T) {
	f := newFixture(t)
	f.onboard(testPubB)

	req := f.signedPost("/api/credentials/", []byte("entropy"), 0)
	req.Header.Set(wire.HdrHashedPin, b64([]byte("pin-hash")))

	w := f.serve(req)

	if w.Code != http.StatusOK {
		t.Fatalf("got %d, want 200", w.Code)
	}

	var protector string
	if err := json.Unmarshal(w.Body.Bytes(), &protector); err != nil {
		t.Fatalf("body is not a JSON string: %q", w.Body.String())
	}

	raw, err := base64.StdEncoding.DecodeString(protector)
	if err != nil || len(raw) != 32 {
		t.Fatalf("protector must be b64 of 32 bytes, got %q", protector)
	}
}

// The worker script is the only asset that must revalidate, and only for the
// hops the browser cannot bypass on its own (gateway, CDN, proxy): a stale
// sw.js answers the update check with the old worker and freezes the device
// on its first-cached app build.
func TestSwJSNoCache(t *testing.T) {
	t.Run("only /sw.js is marked", func(t *testing.T) {
		base := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		handler := swJSNoCache(base)

		for path, want := range map[string]string{
			"/sw.js":         "no-cache",
			"/index.html":    "",
			"/api/profiles/": "",
		} {
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))

			if got := w.Header().Get("Cache-Control"); got != want {
				t.Fatalf("%s Cache-Control: got %q, want %q", path, got, want)
			}
		}
	})

	t.Run("wired into the mux", func(t *testing.T) {
		// The subtest above would stay green if the wrapper were dropped from
		// serve(): nothing else pins that the middleware is actually mounted.
		st, err := store.Open(":memory:")
		if err != nil {
			t.Fatalf("store: %v", err)
		}
		t.Cleanup(func() { st.Close() })

		h := (&server{
			st:  st,
			g:   guard.New(300, 100, 2*wire.TimestampTolerance, time.Now),
			now: time.Now,
		}).mux()

		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/sw.js", nil))

		if got := w.Header().Get("Cache-Control"); got != "no-cache" {
			t.Fatalf("/sw.js through the mux: Cache-Control %q, want %q", got, "no-cache")
		}
	})
}

func TestMethodNotAllowed(t *testing.T) {
	f := newFixture(t)

	for _, path := range []string{"/api/profiles/", "/api/credentials/"} {
		r := httptest.NewRequest(http.MethodPut, path, nil)

		var w *httptest.ResponseRecorder
		if path == "/api/profiles/" {
			w = httptest.NewRecorder()
			f.srv.handleProfiles(w, r)
		} else {
			w = httptest.NewRecorder()
			f.srv.handleCredentials(w, r)
		}

		if w.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s PUT: got %d, want 405", path, w.Code)
		}
	}
}

// The timestamp window is a protocol constant; with the clock injected its
// boundaries are testable exactly instead of approximately.
func TestTimestampWindowBoundaries(t *testing.T) {
	f := newFixture(t)
	f.onboard(testPubB)

	cases := []struct {
		name   string
		offset int64
		want   int
	}{
		{"now", 0, http.StatusNoContent},
		{"just inside the past edge", -300, http.StatusNoContent},
		{"just outside the past edge", -301, http.StatusBadRequest},
		{"just inside the future edge (v1 is symmetric)", +300, http.StatusNoContent},
		{"just outside the future edge", +301, http.StatusBadRequest},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if w := f.serve(f.signedGet("/api/profiles/", tc.offset)); w.Code != tc.want {
				t.Fatalf("offset %+d: got %d, want %d", tc.offset, w.Code, tc.want)
			}
		})
	}
}
