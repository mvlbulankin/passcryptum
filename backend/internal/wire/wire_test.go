package wire

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"passcryptum/internal/guard"
)

var (
	seed      = bytes.Repeat([]byte{0xAB}, ed25519.SeedSize)
	priv      = ed25519.NewKeyFromSeed(seed)
	pub       = priv.Public().(ed25519.PublicKey)
	pubB64    = base64.StdEncoding.EncodeToString(pub)
	realGuard = func() *guard.Guard { return guard.New(300, 100, 2*TimestampTolerance, time.Now) }
	b64       = base64.StdEncoding.EncodeToString
	tsNow     = tsOffset(0)
)

func tsOffset(sec int64) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, uint32(time.Now().Unix()+sec))
	return b
}

func request(headers map[string]string, body []byte) *http.Request {
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}

	r := httptest.NewRequest("POST", "/api/x/", rdr)
	for k, v := range headers {
		r.Header.Set(k, v)
	}

	return r
}

var profilesGet = Recipe{
	Headers:    []string{HdrPublicKey, HdrTimestamp, HdrSignature},
	BodySigned: false,
}

var profilesPost = Recipe{
	Headers:    []string{HdrPublicKey},
	BodySigned: true,
}

var profilesDelete = Recipe{
	Headers:    []string{HdrPublicKey, HdrTimestamp, HdrSignature},
	BodySigned: false,
}

var credentialsGet = Recipe{
	Headers:    []string{HdrPublicKey, HdrHashedPin, HdrProtector, HdrTimestamp},
	BodySigned: false,
}

func signedHeaders(ts []byte) map[string]string {
	return map[string]string{
		HdrPublicKey: pubB64,
		HdrTimestamp: b64(ts),
		HdrSignature: b64(ed25519.Sign(priv, ts)),
	}
}

// signedBody builds b64(sig ‖ ts ‖ payload) with the sig over ts ‖ payload.
func signedBody(ts, payload []byte) []byte {
	msg := append(append([]byte{}, ts...), payload...)
	sig := ed25519.Sign(priv, msg)
	raw := append(append(append([]byte{}, sig...), ts...), payload...)

	return []byte(b64(raw))
}

func TestHeaderRecipeVerifiesSignatureOverTimestamp(t *testing.T) {
	r := request(signedHeaders(tsNow), nil)

	auth, err := ParseRequest(r, realGuard(), profilesGet)
	if err != nil {
		t.Fatalf("valid signed GET must parse: %v", err)
	}

	if auth.PublicB64 != pubB64 {
		t.Fatalf("auth must carry the profile identifier, got %q", auth.PublicB64)
	}
}

func TestHeaderRecipeRejections(t *testing.T) {
	cases := []struct {
		name    string
		headers map[string]string
		field   string
	}{
		{"missing Timestamp", map[string]string{
			HdrPublicKey: pubB64, HdrSignature: b64(ed25519.Sign(priv, tsNow))}, HdrTimestamp},
		{"malformed base64", map[string]string{
			HdrPublicKey: "!!!", HdrTimestamp: b64(tsNow), HdrSignature: b64(ed25519.Sign(priv, tsNow))}, HdrPublicKey},
		{"wrong-length Public-Key", map[string]string{
			HdrPublicKey: b64(bytes.Repeat([]byte{1}, 20)), HdrTimestamp: b64(tsNow), HdrSignature: b64(ed25519.Sign(priv, tsNow))}, HdrPublicKey},
		{"stale timestamp", map[string]string{
			HdrPublicKey: pubB64, HdrTimestamp: b64(tsOffset(-400)),
			HdrSignature: func() string {
				old := tsOffset(-400)
				return b64(ed25519.Sign(priv, old))
			}()}, HdrTimestamp},
		{"invalid signature", map[string]string{
			HdrPublicKey: pubB64, HdrTimestamp: b64(tsNow),
			HdrSignature: b64(ed25519.Sign(priv, []byte("WRONG")))}, HdrSignature},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := request(tc.headers, nil)

			_, err := ParseRequest(r, realGuard(), profilesGet)
			if err == nil {
				t.Fatal("must reject")
			}

			if err.Field != tc.field {
				t.Fatalf("error field = %q, want %q", err.Field, tc.field)
			}

			if err.Status != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", err.Status)
			}
		})
	}
}

func TestUnsignedCredentialRecipeNeedsNoSignature(t *testing.T) {
	r := request(map[string]string{
		HdrPublicKey: pubB64,
		HdrHashedPin: b64([]byte("pin-hash")),
		HdrProtector: b64(bytes.Repeat([]byte{2}, 32)),
		HdrTimestamp: b64(tsNow),
	}, nil)

	auth, err := ParseRequest(r, realGuard(), credentialsGet)
	if err != nil {
		t.Fatalf("unsigned credential GET must parse without Signature: %v", err)
	}

	if auth.HashedPin == "" || auth.Protector == "" {
		t.Fatal("auth must carry the hashed pin and protector")
	}
}

func TestBodyRecipeVerifiesFramingAndReturnsPayload(t *testing.T) {
	payload := []byte(`{"services":{}}`)
	r := request(map[string]string{HdrPublicKey: pubB64}, signedBody(tsNow, payload))

	auth, err := ParseRequest(r, realGuard(), profilesPost)
	if err != nil {
		t.Fatalf("valid signed POST must parse: %v", err)
	}

	if !bytes.Equal(auth.Payload, payload) {
		t.Fatalf("payload = %q, want %q", auth.Payload, payload)
	}
}

func TestBodyRecipeRejections(t *testing.T) {
	cases := []struct {
		name   string
		body   []byte
		field  string
		status int
	}{
		{"empty body", []byte(""), "Body", 400},
		{"not base64", []byte("!!!"), "Body", 400},
		{"too short", []byte(b64(bytes.Repeat([]byte{0}, 67))), "Body", 400},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := request(map[string]string{HdrPublicKey: pubB64}, tc.body)

			_, err := ParseRequest(r, realGuard(), profilesPost)
			if err == nil || err.Field != tc.field || err.Status != tc.status {
				t.Fatalf("got %+v, want field=%s status=%d", err, tc.field, tc.status)
			}
		})
	}

	// The exact contract messages: empty vs short bodies differ.
	for _, tc := range []struct {
		body []byte
		msg  string
	}{
		{[]byte(""), "Body is required"},
		{[]byte(b64(bytes.Repeat([]byte{0}, 67))), "Body is too short"},
	} {
		r := request(map[string]string{HdrPublicKey: pubB64}, tc.body)

		_, err := ParseRequest(r, realGuard(), profilesPost)
		if err == nil || err.Msg != tc.msg {
			t.Fatalf("body %q: got msg=%q, want %q", tc.body, err, tc.msg)
		}
	}

	t.Run("stale body timestamp", func(t *testing.T) {
		old := tsOffset(-400)
		r := request(map[string]string{HdrPublicKey: pubB64}, signedBody(old, []byte("X")))

		_, err := ParseRequest(r, realGuard(), profilesPost)
		if err == nil || err.Field != HdrTimestamp {
			t.Fatalf("got %+v, want timestamp error", err)
		}
	})

	t.Run("signature over wrong message", func(t *testing.T) {
		ts := tsNow
		sig := ed25519.Sign(priv, append(append([]byte{}, ts...), []byte("OTHER")...))
		raw := append(append(append([]byte{}, sig...), ts...), []byte("X")...)

		r := request(map[string]string{HdrPublicKey: pubB64}, []byte(b64(raw)))

		_, err := ParseRequest(r, realGuard(), profilesPost)
		if err == nil || err.Field != HdrSignature {
			t.Fatalf("got %+v, want signature error", err)
		}
	})
}

func TestBodyRecipeRejectsReplay(t *testing.T) {
	g := realGuard()
	body := signedBody(tsNow, []byte("X"))

	r1 := request(map[string]string{HdrPublicKey: pubB64}, body)
	if _, err := ParseRequest(r1, g, profilesPost); err != nil {
		t.Fatalf("first sighting must pass: %v", err)
	}

	r2 := request(map[string]string{HdrPublicKey: pubB64}, body)
	_, err := ParseRequest(r2, g, profilesPost)
	if err == nil || err.Status != http.StatusForbidden {
		t.Fatalf("replayed POST must be 403, got %+v", err)
	}
}

// --- protocol v2 (Protocol-Version: 2) -------------------------------------
// v2: signatures bind the HTTP method, the time window is one-sided
// (0 <= now-ts <= 300), and replay rejection covers GET/DELETE too.

func v2Headers(ts []byte, method string) map[string]string {
	nonce := v2Nonce()

	return map[string]string{
		HdrPublicKey:       pubB64,
		HdrTimestamp:       b64(ts),
		HdrNonce:           b64(nonce),
		HdrSignature:       b64(ed25519.Sign(priv, v2Message(method, ts, nonce, nil))),
		"Protocol-Version": "2",
	}
}

// v2Message: method ‖ ts ‖ nonce ‖ payload.
func v2Message(method string, ts, nonce, payload []byte) []byte {
	out := append([]byte{}, []byte(method)...)
	out = append(out, ts...)
	out = append(out, nonce...)

	return append(out, payload...)
}

func v2Nonce() []byte {
	n := make([]byte, nonceSize)
	for i := range n {
		n[i] = byte(i + 1)
	}

	return n
}

func signedMessage(method string, ts, payload []byte) []byte {
	m := append([]byte{}, []byte(method)...)
	m = append(m, ts...)

	return append(m, payload...)
}

func TestV2SignatureBindsMethod(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/profiles/", nil)
	for k, v := range v2Headers(tsNow, "GET") {
		r.Header.Set(k, v)
	}

	if _, err := ParseRequest(r, realGuard(), profilesGet); err != nil {
		t.Fatalf("v2 GET with method-bound signature must parse: %v", err)
	}

	// Same headers against DELETE: the signature no longer matches the
	// method — a captured GET must not be replayable as DELETE.
	r2 := httptest.NewRequest("DELETE", "/api/profiles/", nil)
	for k, v := range v2Headers(tsNow, "GET") {
		r2.Header.Set(k, v)
	}

	_, err := ParseRequest(r2, realGuard(), profilesDelete)
	if err == nil || err.Field != HdrSignature {
		t.Fatalf("v2 captured GET replayed as DELETE must fail signature, got %+v", err)
	}
}

func TestV2OneSidedWindow(t *testing.T) {
	preIssued := tsOffset(299) // accepted in v1 (quirk), must be rejected in v2

	r := httptest.NewRequest("GET", "/api/profiles/", nil)
	for k, v := range v2Headers(preIssued, "GET") {
		r.Header.Set(k, v)
	}

	_, err := ParseRequest(r, realGuard(), profilesGet)
	if err == nil || err.Field != HdrTimestamp {
		t.Fatalf("v2 must reject pre-issued timestamps, got %+v", err)
	}

	// Same offset still accepted under v1 (contract quirk pinned).
	v1 := signedHeaders(preIssued)
	r1 := httptest.NewRequest("GET", "/api/profiles/", nil)
	for k, v := range v1 {
		r1.Header.Set(k, v)
	}

	if _, err := ParseRequest(r1, realGuard(), profilesGet); err != nil {
		t.Fatalf("v1 must keep accepting pre-issued requests: %v", err)
	}
}

// ADR-0003 amendment: v2 tolerates a client clock up to FutureTolerance
// ahead — zero tolerance rejected real devices with ordinary RTC drift —
// while any larger future offset keeps the pre-issuance rejection.
func TestV2FutureGraceWindow(t *testing.T) {
	cases := []struct {
		name   string
		offset int64
		reject bool
	}{
		{"30 s ahead is ordinary clock drift", 30, false},
		{"60 s ahead is the edge of the grace", 60, false},
		{"61 s ahead is pre-issued", 61, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ts := tsOffset(tc.offset)
			r := httptest.NewRequest("GET", "/api/profiles/", nil)
			for k, v := range v2Headers(ts, "GET") {
				r.Header.Set(k, v)
			}

			_, err := ParseRequest(r, realGuard(), profilesGet)
			if tc.reject && (err == nil || err.Field != HdrTimestamp) {
				t.Fatalf("offset +%d: want timestamp rejection, got %+v", tc.offset, err)
			}

			if !tc.reject && err != nil {
				t.Fatalf("offset +%d: must pass under the grace, got %v", tc.offset, err)
			}
		})
	}
}

func TestV2RejectsGETReplay(t *testing.T) {
	g := realGuard()

	for _, method := range []string{"GET", "DELETE"} {
		r := httptest.NewRequest(method, "/api/profiles/", nil)
		for k, v := range v2Headers(tsNow, method) {
			r.Header.Set(k, v)
		}

		if _, err := ParseRequest(r, g, profilesGet); err != nil {
			t.Fatalf("%s first sighting must pass: %v", method, err)
		}

		// Exact resubmission of the same signed headers.
		r2 := httptest.NewRequest(method, "/api/profiles/", nil)
		for k, v := range v2Headers(tsNow, method) {
			r2.Header.Set(k, v)
		}

		_, err := ParseRequest(r2, g, profilesGet)
		if err == nil || err.Status != http.StatusForbidden {
			t.Fatalf("v2 replayed %s must be 403, got %+v", method, err)
		}
	}
}

func TestV2BodySignatureBindsMethod(t *testing.T) {
	payload := []byte("X")
	ts := tsNow

	nonce := v2Nonce()

	body := func(sigMsg []byte) []byte {
		sig := ed25519.Sign(priv, sigMsg)
		raw := append(append(append([]byte{}, sig...), ts...), payload...)

		return []byte(b64(raw))
	}

	// Correct v2 body: signature over method ‖ ts ‖ nonce ‖ payload.
	r := httptest.NewRequest("POST", "/api/profiles/", bytes.NewReader(body(v2Message("POST", ts, nonce, payload))))
	r.Header.Set(HdrPublicKey, pubB64)
	r.Header.Set(HdrNonce, b64(nonce))
	r.Header.Set("Protocol-Version", "2")

	if _, err := ParseRequest(r, realGuard(), profilesPost); err != nil {
		t.Fatalf("v2 POST with method-bound body signature must parse: %v", err)
	}

	// v1-style body signature (over ts ‖ payload only) must fail in v2.
	r2 := httptest.NewRequest("POST", "/api/profiles/", bytes.NewReader(body(signedMessage("", ts, payload))))
	r2.Header.Set(HdrPublicKey, pubB64)
	r2.Header.Set(HdrNonce, b64(nonce))
	r2.Header.Set("Protocol-Version", "2")

	if _, err := ParseRequest(r2, realGuard(), profilesPost); err == nil {
		t.Fatal("v2 must reject a body signature that does not bind the method")
	}
}

// Regression: two identical requests in the same second used to share a
// signature and trip the replay cache (a double GET failed the second time).
func TestV2NonceMakesSameSecondRequestsDistinct(t *testing.T) {
	g := realGuard()
	ts := tsNow

	for i := 0; i < 3; i++ {
		r := httptest.NewRequest("GET", "/api/profiles/", nil)
		nonce := make([]byte, nonceSize)
		nonce[0] = byte(i + 1) // a different nonce per request

		for k, v := range map[string]string{
			HdrPublicKey:       pubB64,
			HdrTimestamp:       b64(ts),
			HdrNonce:           b64(nonce),
			HdrSignature:       b64(ed25519.Sign(priv, v2Message("GET", ts, nonce, nil))),
			"Protocol-Version": "2",
		} {
			r.Header.Set(k, v)
		}

		if _, err := ParseRequest(r, g, profilesGet); err != nil {
			t.Fatalf("request %d with a fresh nonce must pass: %v", i+1, err)
		}
	}
}

func TestV2RequiresNonce(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/profiles/", nil)
	for k, v := range v2Headers(tsNow, "GET") {
		if k != HdrNonce {
			r.Header.Set(k, v)
		}
	}

	_, err := ParseRequest(r, realGuard(), profilesGet)
	if err == nil || err.Field != HdrNonce || err.Status != 400 {
		t.Fatalf("v2 without a nonce must be a 400 on Nonce, got %+v", err)
	}
}
