// Package guard owns the in-memory security state of the server: per-IP rate
// limiting, POST replay rejection, and per-profile credential lockout. All
// state is process-local and lost on restart by design.
//
// The clock is injected: tests drive windows and expiry with fake time
// instead of sleeping.
package guard

import (
	"encoding/hex"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const lockoutWindow = 10 * time.Minute

type Guard struct {
	mu       sync.Mutex
	seenSigs map[string]time.Time // POST replay cache: pub|sig -> expiry
	ipHits   map[string][]time.Time
	failures map[string][]time.Time // per-profile failed credential auths

	perIPRatePerMin int
	profileFailMax  int
	replayTTL       time.Duration
	now             func() time.Time
}

// New builds a Guard. replayTTL is how long a seen POST signature stays
// cached (the server passes twice the wire timestamp window: a resubmission
// older than that cannot satisfy the window anyway). The clock is injected
// so tests drive windows and expiry with fake time.
func New(perIPRatePerMin, profileFailMax int, replayTTL time.Duration, now func() time.Time) *Guard {
	return &Guard{
		seenSigs:        map[string]time.Time{},
		ipHits:          map[string][]time.Time{},
		failures:        map[string][]time.Time{},
		perIPRatePerMin: perIPRatePerMin,
		profileFailMax:  profileFailMax,
		replayTTL:       replayTTL,
		now:             now,
	}
}

// ClientIP reports the client address. Behind Caddy (the only exposed path;
// ADR-0001) reverse_proxy APPENDS the real peer to any client-supplied
// X-Forwarded-For, so the LAST element is the one we did not trust-lessly
// inherit. Taking the first element would let an attacker rotate XFF and get
// an unlimited per-IP budget.
func ClientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		parts := strings.Split(fwd, ",")
		return strings.TrimSpace(parts[len(parts)-1])
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}

	return host
}

// trimWindow drops entries at or before the cutoff (copy-on-trim: the
// slice may alias map-held storage).
func trimWindow(ts []time.Time, cutoff time.Time) []time.Time {
	trimmed := ts[:0:0]

	for _, t := range ts {
		if t.After(cutoff) {
			trimmed = append(trimmed, t)
		}
	}

	return trimmed
}

// AllowIP is a sliding-window per-IP limiter.
func (g *Guard) AllowIP(ip string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()

	now := g.now()
	trimmed := trimWindow(g.ipHits[ip], now.Add(-time.Minute))

	if len(trimmed) >= g.perIPRatePerMin {
		g.ipHits[ip] = trimmed
		return false
	}

	if len(trimmed) == 0 {
		delete(g.ipHits, ip) // keep the map bounded across IP churn
	}

	g.ipHits[ip] = append(trimmed, now)

	return true
}

// RejectReplay applies to POST endpoints only (mutations). GETs are
// repeatable by design (v1 contract); protocol v2 (ADR-0003) extends replay
// protection to every signed request.
func (g *Guard) RejectReplay(pubB64 string, sig []byte) bool {
	key := replayKey(pubB64, sig)

	g.mu.Lock()
	defer g.mu.Unlock()

	now := g.now()

	if exp, ok := g.seenSigs[key]; ok && exp.After(now) {
		return true
	}

	g.seenSigs[key] = now.Add(g.replayTTL)

	if len(g.seenSigs) > 10000 { // opportunistic GC
		for k, exp := range g.seenSigs {
			if exp.Before(now) {
				delete(g.seenSigs, k)
			}
		}
	}

	return false
}

// Locked: while a profile exceeded profileFailMax failed credential auths in
// the last 10 minutes, credential auth is refused WITHOUT consulting the db —
// counting failures and merely logging the lock would leave the PIN oracle
// open.
func (g *Guard) Locked(pubB64 string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()

	fs := g.failures[pubB64]

	if len(fs) == 0 {
		return false
	}

	window := g.now().Add(-lockoutWindow)
	live := 0

	for _, t := range fs {
		if t.After(window) {
			live++
		}
	}

	if live == 0 {
		delete(g.failures, pubB64)
		return false
	}

	return live > g.profileFailMax
}

// ClearFailures resets the lockout counter after a successful auth.
func (g *Guard) ClearFailures(pubB64 string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.failures, pubB64)
}

// NoteFailure records a failed credential auth; true means the profile is now
// locked.
func (g *Guard) NoteFailure(pubB64 string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()

	now := g.now()
	trimmed := append(trimWindow(g.failures[pubB64], now.Add(-lockoutWindow)), now)
	g.failures[pubB64] = trimmed

	return len(trimmed) > g.profileFailMax
}

func replayKey(pubB64 string, sig []byte) string {
	return pubB64 + "|" + hex.EncodeToString(sig)
}
