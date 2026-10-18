// Package contract holds the wire-protocol contract tests (ADR-0002).
//
// These tests pin the v1 protocol behaviour of ANY Passcryptum backend.
// Changing them == changing the protocol (a new version, ADR-0003).
//
// Protocol summary:
//   - Headers (base64): Public-Key(32B), Hashed-Pin, Protector, Timestamp(4B LE), Signature(64B)
//   - POST bodies: base64(signature(64B) || timestamp(4B LE) || payload)
//   - Timestamp tolerance: +/-300s, symmetric (pre-issued requests are accepted)
//   - 4 endpoints: /api/profiles/, /api/credentials/ (GET/POST/DELETE each)
//   - GET/DELETE /api/credentials/ carry NO signature
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
	"testing"
	"time"
)

const (
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

// do sends a request. headers values are RAW bytes; they get base64-encoded
// onto the wire (that is the protocol).
func (c *client) do(method, path string, body []byte, headers map[string][]byte) (int, []byte) {
	c.t.Helper()
	raw := make(map[string]string, len(headers))
	for k, v := range headers {
		raw[k] = b64(v)
	}
	return c.doRaw(method, path, body, raw)
}

// doRaw sends a request with verbatim header values (for testing malformed base64).
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

// signedBody builds base64(sig || ts || payload) with sig over (ts || payload).
func (c *client) signedBody(tstamp, payload []byte) []byte {
	msg := append(append([]byte{}, tstamp...), payload...)
	sig := ed25519.Sign(c.priv, msg)
	return []byte(b64(append(append(append([]byte{}, sig...), tstamp...), payload...)))
}

// signedHeaders builds Public-Key/Timestamp/Signature headers where the
// signature covers just the timestamp (GET/DELETE /api/profiles/).
func (c *client) signedHeaders(tstamp []byte) map[string][]byte {
	return map[string][]byte{
		hdrPublicKey: c.pub,
		hdrTimestamp: tstamp,
		hdrSignature: ed25519.Sign(c.priv, tstamp),
	}
}

// ============================================================================
// /api/profiles/
// ============================================================================

func TestProfilesLifecycle(t *testing.T) {
	c := newClient(t)

	// Fresh profile: no services -> 204.
	if code, body := c.do("GET", pathProfiles, nil, c.signedHeaders(ts(0))); code != 204 || len(body) != 0 {
		t.Fatalf("empty profile GET: got %d %q, want 204 empty", code, body)
	}

	// POST services: body = sig || ts || services.
	services := []byte(`{"services":{"github":{"login":"me"}}}`)
	if code, body := c.do("POST", pathProfiles, c.signedBody(ts(0), services), c.pubHeader()); code != 200 || len(body) != 0 {
		t.Fatalf("POST services: got %d %q, want 200 empty", code, body)
	}

	// GET returns the base64 of the exact bytes posted, as a JSON string.
	code, body := c.do("GET", pathProfiles, nil, c.signedHeaders(ts(0)))
	if code != 200 {
		t.Fatalf("GET services: got %d %q, want 200", code, body)
	}
	if got := jsonStr(t, body); got != b64(services) {
		t.Fatalf("services round-trip: got %q, want %q", got, b64(services))
	}

	// Overwrite is a plain replace (no versioning, no If-Match — contract quirk).
	services2 := []byte(`{"services":{}}`)
	c.do("POST", pathProfiles, c.signedBody(ts(0), services2), c.pubHeader())
	code, body = c.do("GET", pathProfiles, nil, c.signedHeaders(ts(0)))
	if code != 200 || jsonStr(t, body) != b64(services2) {
		t.Fatalf("services overwrite: got %d %q", code, body)
	}

	// DELETE clears services: 200, then GET -> 204, DELETE again -> 204.
	if code, _ := c.do("DELETE", pathProfiles, nil, c.signedHeaders(ts(0))); code != 200 {
		t.Fatalf("DELETE services: got %d, want 200", code)
	}
	if code, body := c.do("GET", pathProfiles, nil, c.signedHeaders(ts(0))); code != 204 || len(body) != 0 {
		t.Fatalf("GET after delete: got %d %q, want 204 empty", code, body)
	}
	if code, _ := c.do("DELETE", pathProfiles, nil, c.signedHeaders(ts(0))); code != 204 {
		t.Fatalf("DELETE again: got %d, want 204", code)
	}
}

func TestProfilesErrors(t *testing.T) {
	c := newClient(t)

	tests := []struct {
		name     string
		method   string
		body     []byte
		rheaders map[string]string
		want     int
	}{
		{"missing Timestamp header", "GET", nil, map[string]string{
			hdrPublicKey: b64(c.pub), hdrSignature: b64(ed25519.Sign(c.priv, ts(0)))}, 400},
		{"malformed base64 on the wire", "GET", nil, map[string]string{
			hdrPublicKey: "!!!not-base64!!!", hdrTimestamp: b64(ts(0)),
			hdrSignature: b64(ed25519.Sign(c.priv, ts(0)))}, 400},
		{"timestamp 301s in the past", "GET", nil, func() map[string]string {
			tt := ts(-301)
			return map[string]string{hdrPublicKey: b64(c.pub), hdrTimestamp: b64(tt), hdrSignature: b64(ed25519.Sign(c.priv, tt))}
		}(), 400},
		{"invalid signature", "GET", nil, func() map[string]string {
			tt := ts(0)
			return map[string]string{hdrPublicKey: b64(c.pub), hdrTimestamp: b64(tt), hdrSignature: b64(ed25519.Sign(c.priv, []byte("WRONG")))}
		}(), 400},
		{"POST empty body", "POST", []byte(""), map[string]string{hdrPublicKey: b64(c.pub)}, 400},
		{"POST body shorter than 68 bytes", "POST", []byte(b64(bytes.Repeat([]byte{0}, 67))), map[string]string{hdrPublicKey: b64(c.pub)}, 400},
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
		tt := ts(0)
		headers := map[string]string{
			hdrPublicKey: b64(bytes.Repeat([]byte{1}, 20)), // valid base64, 20 bytes
			hdrTimestamp: b64(tt), hdrSignature: b64(ed25519.Sign(c.priv, tt)),
		}
		code, body := c.doRaw("GET", pathProfiles, nil, headers)
		if code >= 400 && code < 500 {
			return
		}
		t.Fatalf("got %d %q, want 4xx", code, body)
	})
}

// TestProfilesQuirkPreIssued pins a documented v1 quirk: the timestamp
// window is symmetric (+/-300s), so a request pre-issued for the future is
// accepted. Fixed in protocol v2 (ADR-0003); v1 keeps it by contract.
func TestProfilesQuirkPreIssued(t *testing.T) {
	c := newClient(t)
	tt := ts(+299)
	headers := map[string][]byte{
		hdrPublicKey: c.pub, hdrTimestamp: tt, hdrSignature: ed25519.Sign(c.priv, tt),
	}
	if code, body := c.do("GET", pathProfiles, nil, headers); code != 204 && code != 200 {
		t.Fatalf("pre-issued (+299s) GET: got %d %q, want 204/200", code, body)
	}
}

// ============================================================================
// /api/credentials/
// ============================================================================

// createCredential POSTs pin+entropy and returns the issued protector (raw bytes).
func (c *client) createCredential(t *testing.T, pin, entropy []byte) []byte {
	t.Helper()
	tt := ts(0)
	body := c.signedBody(tt, entropy) // signature covers ts || entropy
	pb := map[string][]byte{hdrPublicKey: c.pub, hdrHashedPin: pin}
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
		t.Fatalf("GET credential: got %d %q, want 200", code, body)
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

	tests := []struct {
		name    string
		method  string
		body    []byte
		headers map[string][]byte
		want    int
	}{
		{"POST invalid signature", "POST", func() []byte {
			tt := ts(0)
			sig := ed25519.Sign(c.priv, append(append([]byte{}, tt...), []byte("OTHER")...))
			return []byte(b64(append(append(append([]byte{}, sig...), tt...), []byte("X")...)))
		}(), map[string][]byte{hdrPublicKey: c.pub, hdrHashedPin: pin}, 400},
		{"POST stale timestamp", "POST", func() []byte {
			tt := ts(-400)
			return c.signedBody(tt, []byte("X"))
		}(), map[string][]byte{hdrPublicKey: c.pub, hdrHashedPin: pin}, 400},
		{"POST missing Hashed-Pin", "POST", c.signedBody(ts(0), []byte("X")), map[string][]byte{hdrPublicKey: c.pub}, 400},
		{"GET missing Protector", "GET", nil, map[string][]byte{
			hdrPublicKey: c.pub, hdrHashedPin: pin, hdrTimestamp: ts(0)}, 400},
		{"GET stale timestamp", "GET", nil, map[string][]byte{
			hdrPublicKey: c.pub, hdrHashedPin: pin, hdrProtector: bytes.Repeat([]byte{1}, 32), hdrTimestamp: ts(-400)}, 400},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if code, body := c.do(tc.method, pathCredentials, tc.body, tc.headers); code != tc.want {
				t.Fatalf("got %d %q, want %d", code, body, tc.want)
			}
		})
	}
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

	cases := []struct {
		name, method, path string
		body               []byte
		headers            map[string][]byte
	}{
		{"profiles GET", "GET", pathProfiles, nil, map[string][]byte{
			hdrPublicKey: pub2, hdrTimestamp: tt, hdrSignature: sign2(tt)}},
		{"profiles POST", "POST", pathProfiles, func() []byte {
			payload := []byte("S")
			sig := sign2(append(append([]byte{}, tt...), payload...))
			return []byte(b64(append(append(append([]byte{}, sig...), tt...), payload...)))
		}(), map[string][]byte{hdrPublicKey: pub2}},
		{"profiles DELETE", "DELETE", pathProfiles, nil, map[string][]byte{
			hdrPublicKey: pub2, hdrTimestamp: tt, hdrSignature: sign2(tt)}},
		{"credentials POST", "POST", pathCredentials, func() []byte {
			payload := []byte("E")
			sig := sign2(append(append([]byte{}, tt...), payload...))
			return []byte(b64(append(append(append([]byte{}, sig...), tt...), payload...)))
		}(), map[string][]byte{hdrPublicKey: pub2, hdrHashedPin: []byte("PIN")}},
		{"credentials GET", "GET", pathCredentials, nil, map[string][]byte{
			hdrPublicKey: pub2, hdrHashedPin: []byte("PIN"), hdrProtector: bytes.Repeat([]byte{2}, 32), hdrTimestamp: tt}},
		{"credentials DELETE", "DELETE", pathCredentials, nil, map[string][]byte{
			hdrPublicKey: pub2, hdrProtector: bytes.Repeat([]byte{2}, 32), hdrTimestamp: tt}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if code, body := c.do(tc.method, tc.path, tc.body, tc.headers); code != 403 || len(body) != 0 {
				t.Fatalf("unknown profile: got %d %q, want 403 empty", code, body)
			}
		})
	}
}
