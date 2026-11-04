// Package contract holds the wire-protocol contract tests (ADR-0002,
// ADR-0003; the older v1 serving is retired by ADR-0006).
//
// These tests pin the protocol behaviour of ANY Passcryptum backend.
// Changing them == changing the protocol (a new version, see ADR-0002).
//
// Protocol summary:
//   - Every request carries the plain header `Protocol-Version: 2` — the
//     only version the server speaks; anything else is a 400.
//   - Headers (base64): Public-Key(32B), Hashed-Pin, Protector,
//     Timestamp(4B LE), Nonce(16B), Signature(64B)
//   - Signatures cover method ‖ ts ‖ nonce (header recipes) and
//     method ‖ ts ‖ nonce ‖ payload (bodies)
//   - POST bodies: base64(signature(64B) || timestamp(4B LE) || payload)
//   - Timestamp window: −60 ≤ now − ts ≤ 300 (one-sided, 60 s future grace)
//   - Replay rejection on every signed request (signature ‖ nonce key)
//   - 4 endpoints: /api/profiles/, /api/credentials/ (GET/POST/DELETE each)
//   - GET/DELETE /api/credentials/ carry NO signature (factor auth)
//
// Run against a live backend via env:
//
//	PC_BASE_URL     http://127.0.0.1:8777
//	PC_PRIVATE_SEED base64 ed25519 seed (32B) of an ONBOARDED profile
//	PC_PUBLIC_KEY   base64 ed25519 public key (32B) of the same profile
package contract

import (
	"bytes"
	"crypto/ed25519"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const (
	hdrProtocolVersion = "Protocol-Version"
	protocolVersion    = "2"

	hdrPublicKey = "Public-Key"
	hdrHashedPin = "Hashed-Pin"
	hdrProtector = "Protector"
	hdrTimestamp = "Timestamp"
	hdrSignature = "Signature"
	hdrNonce     = "Nonce"

	pathProfiles    = "/api/profiles/"
	pathCredentials = "/api/credentials/"
)

type client struct {
	t    *testing.T
	base string
	pub  ed25519.PublicKey
	priv ed25519.PrivateKey
	hc   *http.Client
}

func newClient(t *testing.T) *client {
	t.Helper()
	base := os.Getenv("PC_BASE_URL")
	if base == "" {
		t.Skip("PC_BASE_URL not set; see backend/contract/README.md (run.sh starts a throwaway Go backend)")
	}
	seed, err := base64.StdEncoding.DecodeString(os.Getenv("PC_PRIVATE_SEED"))
	if err != nil || len(seed) != ed25519.SeedSize {
		t.Fatalf("PC_PRIVATE_SEED must be base64 of a 32-byte ed25519 seed")
	}
	pub, err := base64.StdEncoding.DecodeString(os.Getenv("PC_PUBLIC_KEY"))
	if err != nil || len(pub) != ed25519.PublicKeySize {
		t.Fatalf("PC_PUBLIC_KEY must be base64 of a 32-byte ed25519 public key")
	}
	priv := ed25519.NewKeyFromSeed(seed)
	if !bytes.Equal(pub, priv.Public().(ed25519.PublicKey)) {
		t.Fatalf("PC_PUBLIC_KEY does not match PC_PRIVATE_SEED")
	}
	hc := http.DefaultClient
	if os.Getenv("PC_INSECURE") != "" {
		hc = &http.Client{Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // local self-signed test stacks only
		}}
	}
	return &client{t: t, base: base, pub: pub, priv: priv, hc: hc}
}

// ts returns a 4-byte little-endian unix timestamp, offset seconds from now.
func ts(offsetSecs int64) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, uint32(time.Now().Unix()+offsetSecs))
	return b
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

// nonceSeq keeps every request's nonce distinct so same-second requests
// never collide in the replay cache.
var nonceSeq atomic.Uint64

func nextNonce() []byte {
	n := make([]byte, 16)
	binary.LittleEndian.PutUint64(n, nonceSeq.Add(1))
	return n
}

// do sends a request: the version header rides plain, the given header
// values are RAW bytes and get base64-encoded onto the wire.
func (c *client) do(method, path string, body []byte, headers map[string][]byte) (int, []byte) {
	c.t.Helper()
	raw := map[string]string{hdrProtocolVersion: protocolVersion}
	for k, v := range headers {
		raw[k] = b64(v)
	}
	return c.doRaw(method, path, body, raw)
}

// doRaw sends a request with verbatim header values (for malformed base64
// and the version-header pins).
func (c *client) doRaw(method, path string, body []byte, headers map[string]string) (int, []byte) {
	c.t.Helper()
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, c.base+path, rdr)
	if err != nil {
		c.t.Fatal(err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(resp.Body)
	if err != nil {
		c.t.Fatal(err)
	}
	return resp.StatusCode, out
}

func (c *client) pubHeader() map[string][]byte {
	return map[string][]byte{hdrPublicKey: c.pub}
}

// jsonStr decodes a JSON string response body (success responses are bare
// JSON strings, e.g. the protector or the services blob).
func jsonStr(t *testing.T, body []byte) string {
	t.Helper()
	var s string
	if err := json.Unmarshal(body, &s); err != nil {
		t.Fatalf("response body is not a JSON string: %q", body)
	}
	return s
}

// --- signed builders -------------------------------------------------------

// signedMessage is the header-recipe signed message: method ‖ ts ‖ nonce.
func signedMessage(method string, tstamp, nonce []byte) []byte {
	m := append([]byte{}, []byte(method)...)
	m = append(m, tstamp...)

	return append(m, nonce...)
}

// signedHeaders builds a signed header set for GET/DELETE /api/profiles/;
// the nonce is fresh per call.
func (c *client) signedHeaders(method string, tstamp []byte) map[string][]byte {
	n := nextNonce()

	return map[string][]byte{
		hdrPublicKey: c.pub,
		hdrTimestamp: tstamp,
		hdrNonce:     n,
		hdrSignature: ed25519.Sign(c.priv, signedMessage(method, tstamp, n)),
	}
}

// signedBody builds base64(sig ‖ ts ‖ payload) with the signature over
// method ‖ ts ‖ nonce ‖ payload, and returns the nonce that must ride in
// the Nonce header.
func (c *client) signedBody(method string, tstamp, payload []byte) ([]byte, []byte) {
	n := nextNonce()
	msg := append(signedMessage(method, tstamp, n), payload...)
	sig := ed25519.Sign(c.priv, msg)
	raw := append(append(append([]byte{}, sig...), tstamp...), payload...)

	return []byte(b64(raw)), n
}

// ============================================================================
// the one protocol the server speaks
// ============================================================================

// TestVersionHeaderRequired pins ADR-0006: the version declaration is part
// of every request; anything but `2` is a client error naming the header.
func TestVersionHeaderRequired(t *testing.T) {
	c := newClient(t)

	valid := c.signedHeaders("GET", ts(0))

	for _, tc := range []struct{ name, value string }{
		{"missing header", ""},
		{"old version value", "1"},
		{"unknown version value", "3"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := map[string]string{}
			for k, v := range valid {
				raw[k] = b64(v)
			}
			if tc.value != "" {
				raw[hdrProtocolVersion] = tc.value
			}

			code, body := c.doRaw("GET", pathProfiles, nil, raw)
			if code != 400 {
				t.Fatalf("got %d %q, want 400", code, body)
			}
			if !strings.Contains(string(body), hdrProtocolVersion) {
				t.Fatalf("error must name %s, got %q", hdrProtocolVersion, body)
			}
		})
	}
}

// ============================================================================
// /api/profiles/
// ============================================================================

func TestProfilesLifecycle(t *testing.T) {
	c := newClient(t)

	// Fresh profile: no services -> 204.
	if code, body := c.do("GET", pathProfiles, nil, c.signedHeaders("GET", ts(0))); code != 204 || len(body) != 0 {
		t.Fatalf("empty profile GET: got %d %q, want 204 empty", code, body)
	}

	// POST services: body = sig || ts || services, nonce in the header.
	services := []byte(`{"services":{"github":{"login":"me"}}}`)
	body, n := c.signedBody("POST", ts(0), services)
	headers := c.pubHeader()
	headers[hdrNonce] = n
	if code, resp := c.do("POST", pathProfiles, body, headers); code != 200 || len(resp) != 0 {
		t.Fatalf("POST services: got %d %q, want 200 empty", code, resp)
	}

	// GET returns the base64 of the exact bytes posted, as a JSON string.
	code, out := c.do("GET", pathProfiles, nil, c.signedHeaders("GET", ts(0)))
	if code != 200 {
		t.Fatalf("GET services: got %d, want 200", code)
	}
	if got := jsonStr(t, out); got != b64(services) {
		t.Fatalf("services round-trip: got %q, want %q", got, b64(services))
	}

	// Overwrite is a plain replace (no versioning, no If-Match — contract quirk).
	services2 := []byte(`{"services":{}}`)
	body2, n2 := c.signedBody("POST", ts(0), services2)
	headers2 := c.pubHeader()
	headers2[hdrNonce] = n2
	c.do("POST", pathProfiles, body2, headers2)
	code, out = c.do("GET", pathProfiles, nil, c.signedHeaders("GET", ts(0)))
	if code != 200 || jsonStr(t, out) != b64(services2) {
		t.Fatalf("services overwrite: got %d, want 200 with the new blob", code)
	}

	// DELETE clears services: 200, then GET -> 204, DELETE again -> 204.
	if code, _ := c.do("DELETE", pathProfiles, nil, c.signedHeaders("DELETE", ts(0))); code != 200 {
		t.Fatalf("DELETE services: got %d, want 200", code)
	}
	if code, body := c.do("GET", pathProfiles, nil, c.signedHeaders("GET", ts(0))); code != 204 || len(body) != 0 {
		t.Fatalf("GET after delete: got %d %q, want 204 empty", code, body)
	}
	if code, _ := c.do("DELETE", pathProfiles, nil, c.signedHeaders("DELETE", ts(0))); code != 204 {
		t.Fatalf("DELETE again: got %d, want 204", code)
	}
}

func TestProfilesErrors(t *testing.T) {
	c := newClient(t)

	build := func(mutate func(map[string]string)) map[string]string {
		h := c.signedHeaders("GET", ts(0))
		raw := map[string]string{hdrProtocolVersion: protocolVersion}
		for k, v := range h {
			raw[k] = b64(v)
		}
		mutate(raw)

		return raw
	}

	tests := []struct {
		name     string
		method   string
		body     []byte
		rheaders map[string]string
		want     int
	}{
		{"missing Timestamp header", "GET", nil, build(func(h map[string]string) {
			delete(h, hdrTimestamp)
		}), 400},
		{"malformed base64 on the wire", "GET", nil, build(func(h map[string]string) {
			h[hdrPublicKey] = "!!!not-base64!!!"
		}), 400},
		{"timestamp 301s in the past", "GET", nil, build(func(h map[string]string) {
			h[hdrTimestamp] = b64(ts(-301))
		}), 400},
		{"invalid signature", "GET", nil, build(func(h map[string]string) {
			h[hdrSignature] = b64(ed25519.Sign(c.priv, []byte("WRONG")))
		}), 400},
		{"POST empty body", "POST", []byte(""), map[string]string{
			hdrProtocolVersion: protocolVersion, hdrPublicKey: b64(c.pub)}, 400},
		{"POST body shorter than 68 bytes", "POST", []byte(b64(bytes.Repeat([]byte{0}, 67))), map[string]string{
			hdrProtocolVersion: protocolVersion, hdrPublicKey: b64(c.pub)}, 400},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if code, body := c.doRaw(tc.method, pathProfiles, tc.body, tc.rheaders); code != tc.want {
				t.Fatalf("got %d %q, want %d", code, body, tc.want)
			}
		})
	}
}

// TestHardenedErrors pins error-path behaviour the original design never
// specified precisely: unsupported methods must answer 405 (not 500), and a
// wrong-length Public-Key must be a client error. The frontend never
// triggers these paths, but they are part of the surface.
func TestHardenedErrors(t *testing.T) {
	c := newClient(t)

	t.Run("PUT must be 405", func(t *testing.T) {
		if code, body := c.do("PUT", pathProfiles, nil, c.pubHeader()); code != 405 {
			t.Fatalf("got %d %q, want 405", code, body)
		}
	})
	t.Run("PATCH must be 405", func(t *testing.T) {
		if code, body := c.do("PATCH", pathCredentials, nil, c.pubHeader()); code != 405 {
			t.Fatalf("got %d %q, want 405", code, body)
		}
	})
	t.Run("wrong-length Public-Key must be a client error", func(t *testing.T) {
		headers := c.signedHeaders("GET", ts(0))
		raw := map[string]string{hdrProtocolVersion: protocolVersion}
		for k, v := range headers {
			raw[k] = b64(v)
		}
		raw[hdrPublicKey] = b64(bytes.Repeat([]byte{1}, 20)) // valid base64, 20 bytes

		code, body := c.doRaw("GET", pathProfiles, nil, raw)
		if code >= 400 && code < 500 {
			return
		}
		t.Fatalf("got %d %q, want 4xx", code, body)
	})
}

// TestOneSidedWindow pins the timestamp window −60 ≤ now − ts ≤ 300
// (ADR-0003 with the 2026-10-28 amendment): ordinary clock drift passes,
// anything more than 60 s from the future is a pre-issued request and a
// client error.
func TestOneSidedWindow(t *testing.T) {
	c := newClient(t)

	if code, _ := c.do("GET", pathProfiles, nil, c.signedHeaders("GET", ts(299))); code != 400 {
		t.Fatalf("pre-issued (+299s) GET: got %d, want 400", code)
	}
	if code, _ := c.do("GET", pathProfiles, nil, c.signedHeaders("GET", ts(61))); code != 400 {
		t.Fatalf("61 s ahead: got %d, want 400", code)
	}
	if code, _ := c.do("GET", pathProfiles, nil, c.signedHeaders("GET", ts(30))); code > 299 {
		t.Fatalf("30 s ahead (grace): got %d, want 2xx", code)
	}
	if code, _ := c.do("GET", pathProfiles, nil, c.signedHeaders("GET", ts(-299))); code > 299 {
		t.Fatalf("recent GET must pass, got %d", code)
	}
}

// TestSignatureBindsMethod pins the method-bound signatures (ADR-0003): a
// captured GET signature must not verify as a DELETE, and a body signature
// that skips the method and nonce must not verify at all.
func TestSignatureBindsMethod(t *testing.T) {
	c := newClient(t)

	t.Run("captured GET signature fails as DELETE", func(t *testing.T) {
		headers := c.signedHeaders("GET", ts(0))
		if code, body := c.do("DELETE", pathProfiles, nil, headers); code != 400 {
			t.Fatalf("GET-as-DELETE: got %d %q, want 400 (signature mismatch)", code, body)
		}
	})

	t.Run("body signature must cover method ‖ ts ‖ nonce ‖ payload", func(t *testing.T) {
		tt := ts(0)
		payload := []byte(`{"services":{}}`)

		// Correct signature over the full message; the nonce it covers is
		// the one riding in the header.
		body, n := c.signedBody("POST", tt, payload)
		headers := c.pubHeader()
		headers[hdrNonce] = n
		if code, resp := c.do("POST", pathProfiles, body, headers); code != 200 {
			t.Fatalf("POST with full-message signature: got %d %q, want 200", code, resp)
		}

		// Old-style framing signature (ts ‖ payload only) must be rejected.
		oldSig := ed25519.Sign(c.priv, append(append([]byte{}, tt...), payload...))
		badBody := []byte(b64(append(append(append([]byte{}, oldSig...), tt...), payload...)))

		if code, _ := c.do("POST", pathProfiles, badBody, headers); code != 400 {
			t.Fatalf("old-style body signature: got %d, want 400", code)
		}
	})
}

// TestSignedRequestReplayRejected pins replay protection on every signed
// request (ADR-0003): an exact resubmission of a GET is a bare 403.
func TestSignedRequestReplayRejected(t *testing.T) {
	c := newClient(t)

	headers := c.signedHeaders("GET", ts(-2)) // distinct offset, fresh nonce

	if code, _ := c.do("GET", pathProfiles, nil, headers); code > 299 {
		t.Fatalf("first sighting must pass, got %d", code)
	}
	if code, body := c.do("GET", pathProfiles, nil, headers); code != 403 || len(body) != 0 {
		t.Fatalf("replayed GET: got %d %q, want bare 403", code, body)
	}
}

// ============================================================================
// /api/credentials/
// ============================================================================

// createCredential POSTs pin+entropy and returns the issued protector (raw bytes).
func (c *client) createCredential(t *testing.T, pin, entropy []byte) []byte {
	t.Helper()
	body, n := c.signedBody("POST", ts(0), entropy) // signature covers method ‖ ts ‖ nonce ‖ entropy
	pb := map[string][]byte{hdrPublicKey: c.pub, hdrHashedPin: pin, hdrNonce: n}
	code, resp := c.do("POST", pathCredentials, body, pb)
	if code != 200 {
		t.Fatalf("create credential: got %d %q, want 200", code, resp)
	}
	prot, err := base64.StdEncoding.DecodeString(jsonStr(t, resp))
	if err != nil || len(prot) != 32 {
		t.Fatalf("protector must be base64 of 32 bytes, got %q", resp)
	}

	return prot
}

func (c *client) getCredential(pin, protector []byte) (int, []byte) {
	return c.do("GET", pathCredentials, nil, map[string][]byte{
		hdrPublicKey: c.pub, hdrHashedPin: pin, hdrProtector: protector, hdrTimestamp: ts(0),
	})
}

func TestCredentialLifecycle(t *testing.T) {
	c := newClient(t)
	pin := []byte("PIN-hash-like-value-001")
	entropy := []byte("ENTROPY-BLOB-1")

	prot := c.createCredential(t, pin, entropy)

	// GET returns base64(entropy) as a JSON string.
	code, body := c.getCredential(pin, prot)
	if code != 200 {
		t.Fatalf("GET credential: got %d, want 200", code)
	}
	if got := jsonStr(t, body); got != b64(entropy) {
		t.Fatalf("entropy round-trip: got %q, want %q", got, b64(entropy))
	}

	// Wrong pin -> 403 with empty body.
	if code, body := c.getCredential([]byte("WRONG-PIN"), prot); code != 403 || len(body) != 0 {
		t.Fatalf("wrong pin GET: got %d %q, want 403 empty", code, body)
	}

	// DELETE needs NO pin and NO signature — protector + public key suffice.
	code, body = c.do("DELETE", pathCredentials, nil, map[string][]byte{
		hdrPublicKey: c.pub, hdrProtector: prot, hdrTimestamp: ts(0),
	})
	if code != 200 || len(body) != 0 {
		t.Fatalf("DELETE credential: got %d %q, want 200 empty", code, body)
	}
	if code, _ := c.getCredential(pin, prot); code != 403 {
		t.Fatalf("GET after delete: got %d, want 403", code)
	}
}

// TestUnsignedCredentialGetStillWorks pins the factor-auth quirk: GET
// carries no signature, therefore no replay key — repeating identical
// headers must succeed twice.
func TestUnsignedCredentialGetStillWorks(t *testing.T) {
	c := newClient(t)

	pin := []byte("UNSIGNED-PIN")
	prot := c.createCredential(t, pin, []byte("UNSIGNED-ENTROPY"))

	headers := map[string][]byte{
		hdrPublicKey: c.pub,
		hdrHashedPin: pin,
		hdrProtector: prot,
		hdrTimestamp: ts(0),
	}

	for i := 0; i < 2; i++ {
		if code, body := c.do("GET", pathCredentials, nil, headers); code != 200 {
			t.Fatalf("unsigned credential GET #%d: got %d %q, want 200 (no replay key for unsigned)", i+1, code, body)
		}
	}
}

// TestCredentialEviction pins: max 10 credentials per profile, oldest evicted.
func TestCredentialEviction(t *testing.T) {
	c := newClient(t)
	pin := []byte("EVICTION-PIN")

	protectors := make([][]byte, 11)
	for i := range protectors {
		protectors[i] = c.createCredential(t, pin, []byte{byte('A' + i)})
	}

	// The first (oldest) was evicted by the 11th create.
	if code, body := c.getCredential(pin, protectors[0]); code != 403 {
		t.Fatalf("oldest credential still present: got %d %q, want 403", code, body)
	}
	// The 10 remaining (creators 2..11) are all still present.
	for i := 1; i < 11; i++ {
		code, body := c.getCredential(pin, protectors[i])
		if code != 200 || jsonStr(t, body) != b64([]byte{byte('A' + i)}) {
			t.Fatalf("credential %d missing after eviction: got %d %q", i+1, code, body)
		}
	}

	// Cleanup: delete the rest.
	for _, p := range protectors[1:] {
		c.do("DELETE", pathCredentials, nil, map[string][]byte{
			hdrPublicKey: c.pub, hdrProtector: p, hdrTimestamp: ts(0),
		})
	}
}

func TestCredentialsErrors(t *testing.T) {
	c := newClient(t)
	pin := []byte("ERRORS-PIN")

	t.Run("POST invalid signature", func(t *testing.T) {
		tt := ts(0)
		n := nextNonce()
		sig := ed25519.Sign(c.priv, append(signedMessage("POST", tt, n), []byte("OTHER")...))
		body := []byte(b64(append(append(append([]byte{}, sig...), tt...), []byte("X")...)))
		headers := map[string][]byte{hdrPublicKey: c.pub, hdrHashedPin: pin, hdrNonce: n}

		if code, resp := c.do("POST", pathCredentials, body, headers); code != 400 {
			t.Fatalf("got %d %q, want 400", code, resp)
		}
	})

	t.Run("POST stale timestamp", func(t *testing.T) {
		body, n := c.signedBody("POST", ts(-400), []byte("X"))
		headers := map[string][]byte{hdrPublicKey: c.pub, hdrHashedPin: pin, hdrNonce: n}

		if code, resp := c.do("POST", pathCredentials, body, headers); code != 400 {
			t.Fatalf("got %d %q, want 400", code, resp)
		}
	})

	t.Run("POST missing Hashed-Pin", func(t *testing.T) {
		body, n := c.signedBody("POST", ts(0), []byte("X"))
		headers := map[string][]byte{hdrPublicKey: c.pub, hdrNonce: n}

		if code, resp := c.do("POST", pathCredentials, body, headers); code != 400 {
			t.Fatalf("got %d %q, want 400", code, resp)
		}
	})

	t.Run("GET missing Protector", func(t *testing.T) {
		headers := map[string][]byte{hdrPublicKey: c.pub, hdrHashedPin: pin, hdrTimestamp: ts(0)}

		if code, resp := c.do("GET", pathCredentials, nil, headers); code != 400 {
			t.Fatalf("got %d %q, want 400", code, resp)
		}
	})

	t.Run("GET stale timestamp", func(t *testing.T) {
		headers := map[string][]byte{
			hdrPublicKey: c.pub, hdrHashedPin: pin,
			hdrProtector: bytes.Repeat([]byte{1}, 32), hdrTimestamp: ts(-400)}

		if code, resp := c.do("GET", pathCredentials, nil, headers); code != 400 {
			t.Fatalf("got %d %q, want 400", code, resp)
		}
	})
}

// ============================================================================
// unknown (non-onboarded) profile -> 403 on every endpoint
// ============================================================================

func TestUnknownProfileForbidden(t *testing.T) {
	c := newClient(t)

	// A second keypair that was never onboarded.
	seed2 := bytes.Repeat([]byte{0xAB}, ed25519.SeedSize)
	priv2 := ed25519.NewKeyFromSeed(seed2)
	pub2 := priv2.Public().(ed25519.PublicKey)

	sign2 := func(msg []byte) []byte { return ed25519.Sign(priv2, msg) }
	tt := ts(0)

	// Signed headers from the unknown key: valid wire, unknown profile.
	signed2 := func(method string) map[string][]byte {
		n := nextNonce()

		return map[string][]byte{
			hdrPublicKey: pub2, hdrTimestamp: tt, hdrNonce: n,
			hdrSignature: sign2(signedMessage(method, tt, n)),
		}
	}

	// Signed POST from the unknown key: framing carries the method-bound
	// signature, the nonce rides in the header.
	post2 := func(path string, extra map[string][]byte) (int, []byte) {
		payload := []byte("E")
		n := nextNonce()
		sig := sign2(append(signedMessage("POST", tt, n), payload...))
		body := []byte(b64(append(append(append([]byte{}, sig...), tt...), payload...)))
		headers := map[string][]byte{hdrNonce: n}
		for k, v := range extra {
			headers[k] = v
		}

		return c.do("POST", path, body, headers)
	}

	t.Run("profiles GET", func(t *testing.T) {
		if code, body := c.do("GET", pathProfiles, nil, signed2("GET")); code != 403 || len(body) != 0 {
			t.Fatalf("got %d %q, want 403 empty", code, body)
		}
	})
	t.Run("profiles POST", func(t *testing.T) {
		if code, body := post2(pathProfiles, map[string][]byte{hdrPublicKey: pub2}); code != 403 || len(body) != 0 {
			t.Fatalf("got %d %q, want 403 empty", code, body)
		}
	})
	t.Run("profiles DELETE", func(t *testing.T) {
		if code, body := c.do("DELETE", pathProfiles, nil, signed2("DELETE")); code != 403 || len(body) != 0 {
			t.Fatalf("got %d %q, want 403 empty", code, body)
		}
	})
	t.Run("credentials POST", func(t *testing.T) {
		if code, body := post2(pathCredentials, map[string][]byte{
			hdrPublicKey: pub2, hdrHashedPin: []byte("PIN")}); code != 403 || len(body) != 0 {
			t.Fatalf("got %d %q, want 403 empty", code, body)
		}
	})
	t.Run("credentials GET", func(t *testing.T) {
		if code, body := c.do("GET", pathCredentials, nil, map[string][]byte{
			hdrPublicKey: pub2, hdrHashedPin: []byte("PIN"),
			hdrProtector: bytes.Repeat([]byte{2}, 32), hdrTimestamp: tt}); code != 403 || len(body) != 0 {
			t.Fatalf("got %d %q, want 403 empty", code, body)
		}
	})
	t.Run("credentials DELETE", func(t *testing.T) {
		if code, body := c.do("DELETE", pathCredentials, nil, map[string][]byte{
			hdrPublicKey: pub2, hdrProtector: bytes.Repeat([]byte{2}, 32), hdrTimestamp: tt}); code != 403 || len(body) != 0 {
			t.Fatalf("got %d %q, want 403 empty", code, body)
		}
	})
}
