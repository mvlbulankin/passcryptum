package guard

import (
	"net/http"
	"testing"
	"time"
)

const tolerance = 300 * time.Second

var epoch = time.Unix(1_700_000_000, 0)

func newTestGuard(rate, failMax int) (*Guard, *time.Time) {
	clock := epoch
	g := New(rate, failMax, 2*tolerance, func() time.Time { return clock })

	return g, &clock
}

func TestAllowIPSlidingWindow(t *testing.T) {
	g, clock := newTestGuard(3, 100)

	for i := 0; i < 3; i++ {
		if !g.AllowIP("1.2.3.4") {
			t.Fatalf("hit %d within limit must be allowed", i+1)
		}
	}

	if g.AllowIP("1.2.3.4") {
		t.Fatal("4th hit within the minute must be rejected")
	}

	// Another IP has its own budget.
	if !g.AllowIP("5.6.7.8") {
		t.Fatal("different IP must have its own window")
	}

	// The window slides: hits older than a minute expire.
	*clock = clock.Add(61 * time.Second)

	if !g.AllowIP("1.2.3.4") {
		t.Fatal("hit after the window expired must be allowed again")
	}
}

func TestRejectReplay(t *testing.T) {
	g, clock := newTestGuard(300, 100)
	sig := []byte("signature-bytes")

	if g.RejectReplay("pubA", sig) {
		t.Fatal("first sighting must be accepted")
	}

	if !g.RejectReplay("pubA", sig) {
		t.Fatal("exact resubmission must be rejected")
	}

	if g.RejectReplay("pubB", sig) {
		t.Fatal("same signature under another profile is a different key")
	}

	// Cache entries live twice the timestamp tolerance; after that a
	// resubmission can no longer produce a valid request anyway.
	*clock = clock.Add(2*tolerance + time.Second)

	if g.RejectReplay("pubA", sig) {
		t.Fatal("expired cache entry must be forgotten")
	}
}

func TestProfileLockout(t *testing.T) {
	g, _ := newTestGuard(300, 2)

	if g.Locked("pub") {
		t.Fatal("fresh profile is not locked")
	}

	if g.NoteFailure("pub") {
		t.Fatal("first failure below max must not report locked")
	}

	if g.NoteFailure("pub") {
		t.Fatal("second failure at max must not report locked (locked = over max)")
	}

	if !g.NoteFailure("pub") {
		t.Fatal("third failure over max must report locked")
	}

	if !g.Locked("pub") {
		t.Fatal("profile over the failure max must be locked")
	}

	g.ClearFailures("pub")

	if g.Locked("pub") {
		t.Fatal("successful auth must clear the lockout counter")
	}
}

func TestLockoutWindowExpires(t *testing.T) {
	g, clock := newTestGuard(300, 1)

	g.NoteFailure("pub")
	g.NoteFailure("pub")

	if !g.Locked("pub") {
		t.Fatal("profile must be locked after failures over max")
	}

	*clock = clock.Add(11 * time.Minute)

	if g.Locked("pub") {
		t.Fatal("failures older than 10 minutes must not lock")
	}
}

func TestClientIPTakesXFFTail(t *testing.T) {
	// Behind Caddy (ADR-0001) the proxy APPENDS the real peer to any
	// client-supplied X-Forwarded-For; the LAST element is the one we
	// did not inherit trust-lessly. The head elements are attacker-chosen.
	r, _ := http.NewRequest("GET", "/", nil)
	r.RemoteAddr = "10.0.0.1:1234"
	r.Header.Set("X-Forwarded-For", "1.1.1.1, 2.2.2.2, 3.3.3.3")

	if got := ClientIP(r); got != "3.3.3.3" {
		t.Fatalf("XFF tail must win, got %q", got)
	}

	r2, _ := http.NewRequest("GET", "/", nil)
	r2.RemoteAddr = "10.0.0.1:1234"

	if got := ClientIP(r2); got != "10.0.0.1" {
		t.Fatalf("without XFF the remote host must win, got %q", got)
	}
}
