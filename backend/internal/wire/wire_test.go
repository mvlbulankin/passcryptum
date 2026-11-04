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

func request(method string, headers map[string]string, body []byte) *http.Request {
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}

	r := httptest.NewRequest(method, "/api/x/", rdr)
	for k, v := range headers {
		r.Header.Set(k, v)
	}

	return r
}

var profilesGet = Recipe{
	Headers: []string{HdrPublicKey, HdrTimestamp, HdrSignature},
}

var profilesPost = Recipe{
	Headers:    []string{HdrPublicKey},
	BodySigned: true,
}

var profilesDelete = Recipe{
	Headers: []string{HdrPublicKey, HdrTimestamp, HdrSignature},
}

var credentialsGet = Recipe{
	Headers: []string{HdrPublicKey, HdrHashedPin, HdrProtector, HdrTimestamp},
}

// nonce returns a replay nonce with a distinct first byte per call.
func nonce(seedByte byte) []byte {
	n := make([]byte, nonceSize)
	n[0] = seedByte
	for i := 1; i < nonceSize; i++ {
		n[i] = byte(i)
	}

	return n
}

// signedMessage is the signed message for header recipes: method ‖ ts ‖ nonce.
func signedMessage(method string, ts, n []byte) []byte {
	return concat(concat([]byte(method), ts), n)
}

// signedHeaders builds a valid signed header set for the given method. The
// seed bytes keep calls distinct so same-second requests never collide in
// the replay cache.
func signedHeaders(method string, ts []byte, nonceSeed byte) map[string]string {
	n := nonce(nonceSeed)

	return map[string]string{
		HdrProtocolVersion: ProtocolVersion,
		HdrPublicKey:       pubB64,
		HdrTimestamp:       b64(ts),
		HdrNonce:           b64(n),
		HdrSignature:       b64(ed25519.Sign(priv, signedMessage(method, ts, n))),
	}
}

// signedBody builds b64(sig ‖ ts ‖ payload) with the sig over
// method ‖ ts ‖ nonce ‖ payload. The nonce rides as a header, not inside
// the framing.
func signedBody(method string, ts, payload, n []byte) []byte {
	msg := concat(signedMessage(method, ts, n), payload)
	sig := ed25519.Sign(priv, msg)

	return []byte(b64(concat(concat(sig, ts), payload)))
}

// The server speaks one protocol: every request must declare it. Anything
// else is rejected before any other parsing touches the request.
func TestVersionHeaderRequired(t *testing.T) {
	cases := []struct {
		name   string
		header string
	}{
		{"missing header", ""},
		{"v1 value", "1"},
		{"unknown value", "3"},
		{"garbage", "two"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			headers := signedHeaders("GET", tsNow, 1)
			delete(headers, HdrProtocolVersion)
			if tc.header != "" {
				headers[HdrProtocolVersion] = tc.header
			}

			_, err := ParseRequest(request("GET", headers, nil), realGuard(), profilesGet)
			if err == nil || err.Field != HdrProtocolVersion || err.Status != http.StatusBadRequest {
				t.Fatalf("got %+v, want 400 on %s", err, HdrProtocolVersion)
			}
		})
	}
}

func TestHeaderRecipeVerifiesSignatureOverMethodTimestampNonce(t *testing.T) {
	r := request("GET", signedHeaders("GET", tsNow, 2), nil)

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
		name   string
		mutate func(map[string]string)
		field  string
	}{
		{"missing Timestamp", func(h map[string]string) {
			delete(h, HdrTimestamp)
		}, HdrTimestamp},
		{"malformed base64", func(h map[string]string) {
			h[HdrPublicKey] = "!!!"
		}, HdrPublicKey},
		{"wrong-length Public-Key", func(h map[string]string) {
			h[HdrPublicKey] = b64(bytes.Repeat([]byte{1}, 20))
		}, HdrPublicKey},
		{"stale timestamp", func(h map[string]string) {
			old := tsOffset(-400)
			h[HdrTimestamp] = b64(old)
			h[HdrSignature] = b64(ed25519.Sign(priv, signedMessage("GET", old, nonce(3))))
		}, HdrTimestamp},
		{"pre-issued timestamp", func(h map[string]string) {
			future := tsOffset(299)
			h[HdrTimestamp] = b64(future)
			h[HdrSignature] = b64(ed25519.Sign(priv, signedMessage("GET", future, nonce(3))))
		}, HdrTimestamp},
		{"invalid signature", func(h map[string]string) {
			h[HdrSignature] = b64(ed25519.Sign(priv, []byte("WRONG")))
		}, HdrSignature},
		{"missing nonce", func(h map[string]string) {
			delete(h, HdrNonce)
		}, HdrNonce},
		{"wrong-length nonce", func(h map[string]string) {
			h[HdrNonce] = b64(bytes.Repeat([]byte{9}, 15))
			// The signature still verifies over the original nonce bytes;
			// the length check must fire regardless.
		}, HdrNonce},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			headers := signedHeaders("GET", tsNow, 3)
			tc.mutate(headers)

			_, err := ParseRequest(request("GET", headers, nil), realGuard(), profilesGet)
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

// The 60 s future grace (ADR-0003 amendment): a client clock running ahead
// by an ordinary amount passes; anything beyond the grace is pre-issued and
// rejected.
func TestFutureGraceWindow(t *testing.T) {
	cases := []struct {
		name   string
		offset int64
		reject bool
	}{
		{"30 s ahead is ordinary clock drift", 30, false},
		{"60 s ahead is the edge of the grace", 60, false},
		{"61 s ahead is pre-issued", 61, true},
		{"299 s ahead is pre-issued", 299, true},
	}

	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ts := tsOffset(tc.offset)
			headers := signedHeaders("GET", ts, byte(10+i))

			_, err := ParseRequest(request("GET", headers, nil), realGuard(), profilesGet)
			if tc.reject && (err == nil || err.Field != HdrTimestamp) {
				t.Fatalf("offset +%d: want timestamp rejection, got %+v", tc.offset, err)
			}

			if !tc.reject && err != nil {
				t.Fatalf("offset +%d: must pass under the grace, got %v", tc.offset, err)
			}
		})
	}
}

// A captured GET signature must not verify as a DELETE: the method is bound
// into the signed message.
func TestSignatureBindsMethod(t *testing.T) {
	r2 := request("DELETE", signedHeaders("GET", tsNow, 4), nil)

	_, err := ParseRequest(r2, realGuard(), profilesDelete)
	if err == nil || err.Field != HdrSignature {
		t.Fatalf("captured GET replayed as DELETE must fail signature, got %+v", err)
	}
}

func TestUnsignedCredentialRecipeNeedsNoSignature(t *testing.T) {
	r := request("GET", map[string]string{
		HdrProtocolVersion: ProtocolVersion,
		HdrPublicKey:       pubB64,
		HdrHashedPin:       b64([]byte("pin-hash")),
		HdrProtector:       b64(bytes.Repeat([]byte{2}, 32)),
		HdrTimestamp:       b64(tsNow),
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
	n := nonce(5)
	r := request("POST", map[string]string{
		HdrProtocolVersion: ProtocolVersion,
		HdrPublicKey:       pubB64,
		HdrNonce:           b64(n),
	}, signedBody("POST", tsNow, payload, n))

	auth, err := ParseRequest(r, realGuard(), profilesPost)
	if err != nil {
		t.Fatalf("valid signed POST must parse: %v", err)
	}

	if !bytes.Equal(auth.Payload, payload) {
		t.Fatalf("payload = %q, want %q", auth.Payload, payload)
	}
}

func TestBodyRecipeRejections(t *testing.T) {
	headers := func(n []byte) map[string]string {
		return map[string]string{
			HdrProtocolVersion: ProtocolVersion,
			HdrPublicKey:       pubB64,
			HdrNonce:           b64(n),
		}
	}

	for _, tc := range []struct {
		body []byte
		msg  string
	}{
		{[]byte(""), "Body is required"},
		{[]byte("!!!"), "Invalid Body format"},
		{[]byte(b64(bytes.Repeat([]byte{0}, 67))), "Body is too short"},
	} {
		r := request("POST", headers(nonce(6)), tc.body)

		_, err := ParseRequest(r, realGuard(), profilesPost)
		if err == nil || err.Msg != tc.msg {
			t.Fatalf("body %q: got msg=%q, want %q", tc.body, err, tc.msg)
		}
	}

	t.Run("stale body timestamp", func(t *testing.T) {
		old := tsOffset(-400)
		n := nonce(6)
		r := request("POST", headers(n), signedBody("POST", old, []byte("X"), n))

		_, err := ParseRequest(r, realGuard(), profilesPost)
		if err == nil || err.Field != HdrTimestamp {
			t.Fatalf("got %+v, want timestamp error", err)
		}
	})

	t.Run("signature over wrong message", func(t *testing.T) {
		n := nonce(6)
		sig := ed25519.Sign(priv, signedMessage("POST", tsNow, n))
		raw := append(append(append([]byte{}, sig...), tsNow...), []byte("OTHER")...)

		r := request("POST", headers(n), []byte(b64(raw)))

		_, err := ParseRequest(r, realGuard(), profilesPost)
		if err == nil || err.Field != HdrSignature {
			t.Fatalf("got %+v, want signature error", err)
		}
	})

	t.Run("signature without the nonce bound in", func(t *testing.T) {
		// ts ‖ payload alone (the retired pre-nonce message) must fail.
		n := nonce(6)
		sig := ed25519.Sign(priv, concat(tsNow, []byte("X")))
		raw := append(append(append([]byte{}, sig...), tsNow...), []byte("X")...)

		r := request("POST", headers(n), []byte(b64(raw)))

		_, err := ParseRequest(r, realGuard(), profilesPost)
		if err == nil {
			t.Fatal("must reject a signature that does not cover the nonce")
		}
	})
}

func TestBodyRecipeRejectsReplay(t *testing.T) {
	g := realGuard()
	n := nonce(7)
	body := signedBody("POST", tsNow, []byte("X"), n)
	h := map[string]string{
		HdrProtocolVersion: ProtocolVersion,
		HdrPublicKey:       pubB64,
		HdrNonce:           b64(n),
	}

	r1 := request("POST", h, body)
	if _, err := ParseRequest(r1, g, profilesPost); err != nil {
		t.Fatalf("first sighting must pass: %v", err)
	}

	r2 := request("POST", h, body)
	_, err := ParseRequest(r2, g, profilesPost)
	if err == nil || err.Status != http.StatusForbidden {
		t.Fatalf("replayed POST must be 403, got %+v", err)
	}
}

// Replay rejection covers GET/DELETE too: the per-request nonce makes every
// legitimate signature unique, so a repeat sighting is always a replay.
func TestHeaderRecipeRejectsReplay(t *testing.T) {
	g := realGuard()

	for i, method := range []string{"GET", "DELETE"} {
		h := signedHeaders(method, tsNow, byte(20+i))
		r1 := request(method, h, nil)

		if _, err := ParseRequest(r1, g, profilesGet); err != nil {
			t.Fatalf("%s first sighting must pass: %v", method, err)
		}

		r2 := request(method, h, nil)
		_, err := ParseRequest(r2, g, profilesGet)
		if err == nil || err.Status != http.StatusForbidden {
			t.Fatalf("replayed %s must be 403, got %+v", method, err)
		}
	}
}

// Regression: two identical requests in the same second used to share a
// signature and trip the replay cache (a double GET failed the second time).
func TestNonceMakesSameSecondRequestsDistinct(t *testing.T) {
	g := realGuard()

	for i := 0; i < 3; i++ {
		r := request("GET", signedHeaders("GET", tsNow, byte(30+i)), nil)

		if _, err := ParseRequest(r, g, profilesGet); err != nil {
			t.Fatalf("request %d with a fresh nonce must pass: %v", i+1, err)
		}
	}
}

// The nonce requirement is derived from the recipe, not declared on it: a
// signed recipe that forgot a flag would silently reintroduce the same-
// second collision the nonce exists to prevent.
func TestNonceIsDerivedFromTheRecipeBeingSigned(t *testing.T) {
	g := realGuard()

	assertNeedsNonce := func(name string, rec Recipe, headers map[string]string) {
		t.Helper()

		delete(headers, HdrNonce)

		if _, err := ParseRequest(request("GET", headers, nil), g, rec); err == nil {
			t.Fatalf("%s: a signed recipe must reject a request without a nonce", name)
		}
	}

	// Header-signed, body-signed: both derived as signed.
	assertNeedsNonce("header recipe", profilesGet, signedHeaders("GET", tsNow, 40))
	assertNeedsNonce("body recipe", profilesPost, map[string]string{
		HdrProtocolVersion: ProtocolVersion,
		HdrPublicKey:       pubB64,
	})

	// The unsigned credential recipe keeps its factor-auth quirk: no nonce,
	// no signature, and it must still pass.
	unsigned := map[string]string{
		HdrProtocolVersion: ProtocolVersion,
		HdrPublicKey:       pubB64,
		HdrHashedPin:       b64([]byte("pin")),
		HdrProtector:       b64([]byte("prot")),
		HdrTimestamp:       b64(tsNow),
	}

	if _, err := ParseRequest(request("GET", unsigned, nil), g, credentialsGet); err != nil {
		t.Fatalf("an unsigned recipe must not require a nonce: %v", err)
	}
}

// NeedsProfile is a recipe clause with one owner: the pipeline answers 403
// itself, before the domain function runs.
func TestNeedsProfileIsEnforcedByThePipeline(t *testing.T) {
	g := realGuard()

	rec := Recipe{
		Headers:      []string{HdrPublicKey, HdrTimestamp, HdrSignature},
		NeedsProfile: true,
	}
	fixedNow := func() time.Time {
		return time.Unix(int64(binary.LittleEndian.Uint32(tsNow)), 0)
	}

	// A fresh nonce per subtest: accepted signatures stay in the replay
	// cache, so reusing one would test the cache, not the profile clause.
	headersFor := func(seed byte) map[string]string {
		return signedHeaders("GET", tsNow, seed)
	}

	t.Run("unknown profile is forbidden before the handler runs", func(t *testing.T) {
		opts := Options{
			Now:           fixedNow,
			ProfileExists: func(string) (bool, error) { return false, nil },
		}

		_, err := ParseRequestWith(request("GET", headersFor(41), nil), g, rec, opts)
		if err == nil || err.Status != http.StatusForbidden {
			t.Fatalf("want 403, got %#v", err)
		}
	})

	t.Run("known profile passes", func(t *testing.T) {
		opts := Options{
			Now:           fixedNow,
			ProfileExists: func(string) (bool, error) { return true, nil },
		}

		if _, err := ParseRequestWith(request("GET", headersFor(42), nil), g, rec, opts); err != nil {
			t.Fatalf("a known profile must pass: %v", err)
		}
	})

	t.Run("a missing checker fails closed", func(t *testing.T) {
		// Declaring NeedsProfile without supplying the checker is a wiring
		// bug: serving the endpoint unchecked would be worse than a 500.
		opts := Options{Now: fixedNow}

		_, err := ParseRequestWith(request("GET", headersFor(43), nil), g, rec, opts)
		if err == nil || err.Status != http.StatusInternalServerError {
			t.Fatalf("want 500, got %#v", err)
		}
	})
}
