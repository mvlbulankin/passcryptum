// Package wire parses and verifies the Wire Protocol in both versions:
// frozen v1 (ADR-0002) and v2 (ADR-0003, `Protocol-Version: 2` — method-bound
// signatures, one-sided time window, replay rejection on every signed
// request). Base64 headers, Ed25519 signatures over header-timestamp or body
// framing b64(sig ‖ ts ‖ payload), replay rejection through the guard. Each
// endpoint declares a Recipe; ParseRequest runs the shared pipeline so the
// six handlers carry domain logic only.
package wire

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"passcryptum/internal/guard"
)

const (
	HdrPublicKey = "Public-Key"
	HdrHashedPin = "Hashed-Pin"
	HdrProtector = "Protector"
	HdrTimestamp = "Timestamp"
	HdrSignature = "Signature"
	HdrNonce     = "Nonce"
)

// nonceSize is the v2 replay nonce length (random per request, carried in
// the signed message so same-second requests never share a signature).
const nonceSize = 16

// TimestampTolerance is the protocol's ±300 s request window (ADR-0002).
const TimestampTolerance = 300 * time.Second

// FutureTolerance is the v2 grace for a client clock running ahead: v2
// accepts −FutureTolerance ≤ now−ts ≤ TimestampTolerance (ADR-0003,
// amendment 2026-10-28). Zero tolerance rejected real devices whose RTC had
// drifted by a second; 60 s is the JWT ecosystem's canonical leeway and a
// fifth of the backward window, so v2 stays far tighter than the symmetric
// industry defaults.
const FutureTolerance = 60 * time.Second

// Recipe declares what an endpoint requires from the wire.
type Recipe struct {
	// Headers are the required base64 headers, in validation order.
	Headers []string

	// BodySigned marks POST mutations: the body is b64(sig(64) ‖ ts(4 LE) ‖
	// payload), and exact resubmissions are rejected as replays. The
	// signature covers ts ‖ payload in v1 and method ‖ ts ‖ payload in v2;
	// otherwise the Signature header covers the Timestamp bytes (v2: with the
	// method prefixed).
	BodySigned bool

	// NeedsProfile makes the endpoint answer 403 for a key that was never
	// onboarded. It is part of the contract, so it belongs to the recipe
	// rather than to each handler's memory.
	NeedsProfile bool
}

// Options carries what the pipeline needs besides the request itself. The
// clock is injected so the timestamp window can be tested at its exact
// boundaries instead of relative to the wall clock.
type Options struct {
	Now func() time.Time
}

// Auth is the verified request identity plus any payload the recipe carried.
// Only what a handler acts on is exported: the public key stays inside the
// pipeline, and the nonce never leaves it.
type Auth struct {
	PublicB64 string // base64 as sent: the Profile identifier
	HashedPin string // b64 text as sent, "" if the recipe does not require it
	Protector string // b64 text
	Payload   []byte // set for BodySigned recipes
}

// Error is a wire-level failure mapped onto an HTTP status. Status 400
// carries the contract's JSON body {"field":["msg"]}; anything else is bare.
type Error struct {
	Status int
	Field  string
	Msg    string

	// Reason carries a loggable audit cause, so the server can emit its
	// line for rejections and denials alike.
	Reason string
}

func errField(field, msg string) *Error {
	return &Error{Status: http.StatusBadRequest, Field: field, Msg: msg, Reason: field + ": " + msg}
}

func (e *Error) Error() string { return e.Field + ": " + e.Msg }

func (e *Error) Write(w http.ResponseWriter) {
	if e.Status != http.StatusBadRequest {
		w.WriteHeader(e.Status)
		return
	}

	body, _ := json.Marshal(map[string][]string{e.Field: {e.Msg}})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	w.Write(body)
}

// WriteJSONString emits the protocol's success body: a bare JSON string.
func WriteJSONString(w http.ResponseWriter, s string) {
	body, _ := json.Marshal(s)
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

// ParseRequest runs the shared pipeline for the recipe: header presence and
// decoding, timestamp window, signature verification, body framing, and —
// where the protocol version demands it — replay rejection. A nil Error
// means the caller is cryptographically the profile it claims (the
// profile's existence is the store's business, not the wire's).
//
// Versioning: requests carrying `Protocol-Version: 2` get the v2 semantics
// (ADR-0003) — signatures bind the HTTP method, the timestamp window is
// one-sided (0 <= now-ts <= 300), and replay rejection covers GET/DELETE
// too. Without the header the frozen v1 behavior applies (ADR-0002), so
// cached old frontends keep working while their service worker updates.
func ParseRequest(r *http.Request, g *guard.Guard, rec Recipe) (*Auth, *Error) {
	return ParseRequestWith(r, g, rec, Options{})
}

// pending is the pipeline's scratch space. The verified public key and the
// nonce never leave this package: handlers act on the Profile identifier and
// the payload, nothing else.
type pending struct {
	auth      Auth
	publicKey ed25519.PublicKey
	nonce     []byte
}

// ParseRequestWith is ParseRequest with dependencies injected (the clock).
func ParseRequestWith(
	r *http.Request,
	g *guard.Guard,
	rec Recipe,
	opts Options,
) (*Auth, *Error) {
	now := opts.Now
	if now == nil {
		now = time.Now
	}

	p := &pending{}
	var timestamp, signature, nonce []byte
	v2 := r.Header.Get("Protocol-Version") == "2"

	for _, name := range rec.Headers {
		v := r.Header.Get(name)
		if v == "" {
			return nil, errField(name, name+" is required")
		}

		raw, err := base64.StdEncoding.DecodeString(v)
		if err != nil {
			return nil, errField(name, "Invalid "+name+" format")
		}

		switch name {
		case HdrPublicKey:
			if len(raw) != ed25519.PublicKeySize {
				return nil, errField(name, "Invalid "+name+" format")
			}

			p.publicKey = ed25519.PublicKey(raw)
			p.auth.PublicB64 = v
		case HdrHashedPin:
			p.auth.HashedPin = v
		case HdrProtector:
			p.auth.Protector = v
		case HdrTimestamp:
			timestamp = raw
		case HdrSignature:
			signature = raw
		case HdrNonce:
			nonce = raw
		}
	}

	// v2 requires a nonce on signed requests: it makes every request's
	// signature unique, so the replay cache never rejects a legitimate second
	// request within the same timestamp second. Unsigned credential requests
	// keep their factor-auth quirk and carry no nonce.
	if v2 && (signature != nil || rec.BodySigned) {
		// Read it here rather than via Recipe.Headers: the header is required
		// by the version, not declaratively by the endpoint.
		if raw := r.Header.Get(HdrNonce); raw != "" {
			decoded, derr := base64.StdEncoding.DecodeString(raw)
			if derr != nil {
				return nil, errField(HdrNonce, "Invalid "+HdrNonce+" format")
			}

			nonce = decoded
		}

		if nonce == nil {
			return nil, errField(HdrNonce, HdrNonce+" is required")
		}

		if len(nonce) != nonceSize {
			return nil, errField(HdrNonce, "Invalid "+HdrNonce+" format")
		}

		p.nonce = nonce
	}

	if rec.BodySigned {
		return parseSignedBody(r, g, p, v2, now)
	}

	if err := checkTimestamp(timestamp, v2, now); err != nil {
		return nil, err
	}

	// Recipes without HdrSignature (GET/DELETE /api/credentials/, the v1
	// unsigned quirk) skip verification; presence is enforced above when the
	// recipe lists the header. v2 binds the method into the signed message,
	// so a captured GET signature cannot be replayed as a DELETE.
	if signature != nil {
		msg := timestamp

		if v2 {
			msg = concat(concat([]byte(r.Method), timestamp), nonce)
		}

		if err := verify(p.publicKey, msg, signature); err != nil {
			return nil, err
		}
	}

	// v2: replay rejection covers GET/DELETE too — signatures now differ per
	// request (fresh timestamp + nonce), so a repeat sighting is a replay.
	if v2 && signature != nil &&
		g.RejectReplay(p.auth.PublicB64, replayBytes(signature, nonce)) {
		return nil, &Error{Status: http.StatusForbidden, Reason: "replayed request"}
	}

	return &p.auth, nil
}

func parseSignedBody(
	r *http.Request,
	g *guard.Guard,
	p *pending,
	v2 bool,
	now func() time.Time,
) (*Auth, *Error) {
	body, err := readBody(r)
	if err != nil || len(body) == 0 {
		return nil, errField("Body", "Body is required")
	}

	raw, derr := base64.StdEncoding.DecodeString(string(body))
	if derr != nil {
		return nil, errField("Body", "Invalid Body format")
	}

	if len(raw) < 68 { // sig(64) + ts(4) + at least nothing
		return nil, errField("Body", "Body is too short")
	}

	sig, tstamp, payload := raw[:64], raw[64:68], raw[68:]

	if err := checkTimestamp(tstamp, v2, now); err != nil {
		return nil, err
	}

	msg := concat(tstamp, payload)

	if v2 {
		msg = concat(concat(concat([]byte(r.Method), tstamp), p.nonce), payload)
	}

	if err := verify(p.publicKey, msg, sig); err != nil {
		return nil, err
	}

	if g.RejectReplay(p.auth.PublicB64, sig) {
		return nil, &Error{Status: http.StatusForbidden, Reason: "replayed POST"}
	}

	p.auth.Payload = payload

	return &p.auth, nil
}

func checkTimestamp(raw []byte, oneSided bool, now func() time.Time) *Error {
	if len(raw) != 4 {
		return errField(HdrTimestamp, "Malformed timestamp")
	}

	t := int64(binary.LittleEndian.Uint32(raw))
	d := now().Unix() - t

	// v1: symmetric ±300 s (pre-issued requests accepted — pinned quirk).
	// v2: one-sided with a 60 s future grace (ADR-0003 amendment): ordinary
	// client clock drift passes, pre-issued requests beyond the grace stay
	// rejected.
	bad := d > int64(TimestampTolerance/time.Second) ||
		(oneSided && d < -int64(FutureTolerance/time.Second)) ||
		(!oneSided && d < -int64(TimestampTolerance/time.Second))

	if bad {
		return errField(HdrTimestamp, "Invalid timestamp")
	}

	return nil
}

func verify(pub ed25519.PublicKey, msg, sig []byte) *Error {
	if len(sig) != ed25519.SignatureSize || !ed25519.Verify(pub, msg, sig) {
		return errField(HdrSignature, "Invalid signature")
	}

	return nil
}

// replayBytes is the v2 replay-cache key material: the signature already
// covers the nonce, concatenating keeps the call sites honest.
func replayBytes(signature, nonce []byte) []byte {
	return concat(signature, nonce)
}

func concat(a, b []byte) []byte {
	if len(b) == 0 {
		return a
	}

	return append(append([]byte{}, a...), b...)
}

func readBody(r *http.Request) ([]byte, error) {
	buf, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}

	return buf, nil
}
