// Protocol v2 contract tests (ADR-0003). The same server speaks both
// versions: requests carrying `Protocol-Version: 2` get method-bound
// signatures, a one-sided time window, and replay rejection on GET/DELETE;
// without the header the frozen v1 behavior applies (see contract_test.go).
package contract

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

// v2Message is the v2 signed message: method ‖ timestamp ‖ nonce ‖ payload.
func v2Message(method string, tstamp, nonce, payload []byte) []byte {
	m := append([]byte{}, []byte(method)...)
	m = append(m, tstamp...)
	m = append(m, nonce...)

	return append(m, payload...)
}

// v2Nonce returns 16 distinct bytes — the per-request replay nonce.
func v2Nonce(seed byte) []byte {
	n := make([]byte, 16)
	for i := range n {
		n[i] = seed + byte(i)
	}

	return n
}

// v2Do sends a v2 request. Signed headers (Timestamp/Signature) cover the
// method; Protocol-Version rides as a plain (non-b64) header.
func (c *client) v2Do(method, path string, body []byte, headers map[string][]byte) (int, []byte) {
	c.t.Helper()
	raw := map[string]string{"Protocol-Version": "2"}
	for k, v := range headers {
		raw[k] = b64(v)
	}

	return c.doRaw(method, path, body, raw)
}

func (c *client) v2SignedHeaders(method string, tstamp []byte, nonce []byte) map[string][]byte {
	return map[string][]byte{
		hdrPublicKey: c.pub,
		hdrTimestamp: tstamp,
		hdrNonce:     nonce,
		hdrSignature: ed25519.Sign(c.priv, v2Message(method, tstamp, nonce, nil)),
	}
}

func TestV2MethodBoundSignatures(t *testing.T) {
	c := newClient(t)

	t.Run("GET with method-bound signature works", func(t *testing.T) {
		if code, body := c.v2Do("GET", pathProfiles, nil, c.v2SignedHeaders("GET", ts(0), v2Nonce(1))); code != 204 && code != 200 {
			t.Fatalf("v2 GET: got %d %q, want 204/200", code, body)
		}
	})

	t.Run("captured GET signature fails as DELETE", func(t *testing.T) {
		code, body := c.v2Do("DELETE", pathProfiles, nil, c.v2SignedHeaders("GET", ts(0), v2Nonce(1)))
		if code != 400 {
			t.Fatalf("v2 GET-as-DELETE: got %d %q, want 400 (signature mismatch)", code, body)
		}
	})

	t.Run("POST body signature binds the method", func(t *testing.T) {
		tt := ts(0)
		payload := []byte(`{"services":{"v2":{}}}`)
		nonce := v2Nonce(20)
		sig := ed25519.Sign(c.priv, v2Message("POST", tt, nonce, payload))
		body := []byte(b64(append(append(append([]byte{}, sig...), tt...), payload...)))
		pb := map[string][]byte{hdrPublicKey: c.pub, hdrNonce: nonce}

		if code, resp := c.v2Do("POST", pathProfiles, body, pb); code != 200 {
			t.Fatalf("v2 POST: got %d %q, want 200", code, resp)
		}

		// Same body under DELETE would need a different signature: framing
		// carries no method, the signature must.
		v1Style := append(append([]byte{}, tt...), payload...)
		oldSig := ed25519.Sign(c.priv, v1Style)
		badBody := []byte(b64(append(append(append([]byte{}, oldSig...), tt...), payload...)))

		if code, _ := c.v2Do("POST", pathProfiles, badBody, pb); code != 400 {
			t.Fatalf("v1-style body signature under v2: got %d, want 400", code)
		}
	})
}

func TestV2OneSidedWindow(t *testing.T) {
	c := newClient(t)

	// Pre-issued (+299 s) is a pinned v1 quirk (TestProfilesQuirkPreIssued)
	// but must be rejected under v2.
	if code, _ := c.v2Do("GET", pathProfiles, nil, c.v2SignedHeaders("GET", ts(299), v2Nonce(2))); code != 400 {
		t.Fatalf("v2 pre-issued GET: got %d, want 400", code)
	}

	if code, _ := c.v2Do("GET", pathProfiles, nil, c.v2SignedHeaders("GET", ts(-299), v2Nonce(3))); code > 299 {
		t.Fatalf("v2 recent GET must pass, got %d", code)
	}

	// The 60 s future grace (ADR-0003 amendment): ordinary clock drift must
	// pass; anything larger keeps the pre-issuance rejection above.
	if code, _ := c.v2Do("GET", pathProfiles, nil, c.v2SignedHeaders("GET", ts(30), v2Nonce(4))); code > 299 {
		t.Fatalf("v2 GET 30 s ahead (grace): got %d, want 2xx", code)
	}

	if code, _ := c.v2Do("GET", pathProfiles, nil, c.v2SignedHeaders("GET", ts(61), v2Nonce(5))); code != 400 {
		t.Fatalf("v2 GET 61 s ahead: got %d, want 400", code)
	}
}

func TestV2GETReplayRejected(t *testing.T) {
	c := newClient(t)

	// A distinct offset: other tests' GETs at ts(0) in the same second would
	// otherwise collide in the replay cache (identical signed bytes).
	headers := c.v2SignedHeaders("GET", ts(-2), v2Nonce(9))

	if code, _ := c.v2Do("GET", pathProfiles, nil, headers); code > 299 {
		t.Fatalf("first sighting must pass, got %d", code)
	}

	if code, body := c.v2Do("GET", pathProfiles, nil, headers); code != 403 || len(body) != 0 {
		t.Fatalf("replayed v2 GET: got %d %q, want bare 403", code, body)
	}
}

func TestV2UnsignedCredentialGetStillWorks(t *testing.T) {
	c := newClient(t)

	// The unsigned quirk survives in v2: factors + timestamp, no signature.
	// Create a real v2 credential (method-bound body signature), then GET
	// twice with identical headers — unsigned requests have no replay key,
	// so BOTH must succeed.
	pin := []byte("V2-PIN")
	tt := ts(0)
	entropy := []byte("V2-ENTROPY")
	nonce := v2Nonce(30)
	sig := ed25519.Sign(c.priv, v2Message("POST", tt, nonce, entropy))
	body := []byte(b64(append(append(append([]byte{}, sig...), tt...), entropy...)))

	code, resp := c.v2Do("POST", pathCredentials, body, map[string][]byte{
		hdrPublicKey: c.pub,
		hdrHashedPin: pin,
		hdrNonce:     nonce,
	})
	if code != 200 {
		t.Fatalf("v2 create credential: got %d %q, want 200", code, resp)
	}

	// The response body is the b64 text of the 32-byte protector; the wire
	// header must carry the same b64 text, so feed v2Do the DECODED bytes.
	protector, err := base64.StdEncoding.DecodeString(decodeStr(t, resp))
	if err != nil || len(protector) != 32 {
		t.Fatalf("protector must be b64 of 32 bytes, got %q", resp)
	}

	headers := map[string][]byte{
		hdrPublicKey: c.pub,
		hdrHashedPin: pin,
		hdrProtector: protector,
		hdrTimestamp: ts(0),
	}

	for i := 0; i < 2; i++ {
		if code, body := c.v2Do("GET", pathCredentials, nil, headers); code != 200 {
			t.Fatalf("v2 unsigned credential GET #%d: got %d %q, want 200 (no replay key for unsigned)", i+1, code, body)
		}
	}
}

func decodeStr(t *testing.T, body []byte) string {
	t.Helper()
	var s string
	if err := json.Unmarshal(body, &s); err != nil {
		t.Fatalf("response is not a JSON string: %q", body)
	}
	return s
}

// TestV1StillServed pins the compatibility promise: without the version
// header the server behaves exactly as the frozen v1 contract.
func TestV1StillServed(t *testing.T) {
	c := newClient(t)

	// v1 signature (over bare timestamp) still verifies without the header.
	if code, _ := c.do("GET", pathProfiles, nil, c.signedHeaders(ts(0))); code != 204 && code != 200 {
		t.Fatalf("v1 GET must keep working: got %d", code)
	}

	// ...and the pre-issued quirk stays (doRaw to avoid re-signing helpers).
	tt := ts(299)
	v1 := map[string]string{
		hdrPublicKey: b64(c.pub),
		hdrTimestamp: b64(tt),
		hdrSignature: b64(ed25519.Sign(c.priv, tt)),
	}

	if code, _ := c.doRaw("GET", pathProfiles, nil, v1); code != 204 && code != 200 {
		t.Fatalf("v1 pre-issued quirk must stay: got %d", code)
	}

	_ = base64.StdEncoding // keep import parity with helpers
	_ = time.Now
}
