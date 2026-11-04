// Package wire parses and verifies the Wire Protocol (ADR-0002; the
// current semantics come from ADR-0003 — method-bound signatures with a
// per-request nonce, the one-sided time window, replay rejection on every
// signed request). Every request declares `Protocol-Version: 2`, the only
// version the server speaks (ADR-0006 retired the older v1 serving).
// Base64 headers, Ed25519 signatures over header-timestamp or body framing
// b64(sig ‖ ts ‖ payload), replay rejection through the guard. Each
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
	"slices"
	"time"

	"passcryptum/internal/guard"
)

const (
	HdrPublicKey       = "Public-Key"
	HdrHashedPin       = "Hashed-Pin"
	HdrProtector       = "Protector"
	HdrTimestamp       = "Timestamp"
	HdrSignature       = "Signature"
	HdrNonce           = "Nonce"
	HdrProtocolVersion = "Protocol-Version"
)

// ProtocolVersion is the only value HdrProtocolVersion accepts. The number
// stays (ADR-0002: semantic changes ship as new versions negotiated by this
// header); what ADR-0006 retired is serving any older one.
const ProtocolVersion = "2"

// nonceSize is the replay nonce length (random per request, carried in the
// signed message so same-second requests never share a signature).
const nonceSize = 16

// TimestampTolerance is the backward half of the request window: now−ts
// may lag at most 300 s (ADR-0002; the symmetric future half was closed by
// ADR-0003).
const TimestampTolerance = 300 * time.Second

// FutureTolerance is the grace for a client clock running ahead: the window
// accepts −FutureTolerance ≤ now−ts ≤ TimestampTolerance (ADR-0003,
// amendment 2026-10-28). Zero tolerance rejected real devices whose RTC had
// drifted by a second; 60 s is the JWT ecosystem's canonical leeway and a
// fifth of the backward window, so the window stays far tighter than the
// symmetric industry defaults.
const FutureTolerance = 60 * time.Second

// Recipe declares what an endpoint requires from the wire.
type Recipe struct {
	// Headers are the required base64 headers, in validation order.
	Headers []string

	// BodySigned marks POST mutations: the body is b64(sig(64) ‖ ts(4 LE) ‖
	// payload), and exact resubmissions are rejected as replays. The
	// signature covers method ‖ ts ‖ nonce ‖ payload; otherwise the
	// Signature header covers method ‖ ts ‖ nonce.
	BodySigned bool

	// NeedsProfile makes the endpoint answer 403 for a key that was never
	// onboarded. It is part of the contract, so it belongs to the recipe
	// rather than to each handler's memory — and the pipeline, not the mux,
	// enforces it (Options.ProfileExists).
	NeedsProfile bool
}

// signed reports whether the recipe authenticates by signature. The nonce
// requirement is DERIVED, never declared: a signature must cover a nonce
// (ADR-0003) or two requests in the same second collide in the replay
// cache, and a recipe that forgets a NeedsNonce flag would break exactly
// that invariant. Unsigned credential requests keep their factor-auth quirk
// and carry no nonce.
func (r Recipe) signed() bool {
	return r.BodySigned || slices.Contains(r.Headers, HdrSignature)
}

// Options carries what the pipeline needs besides the request itself. The
// clock is injected so the timestamp window can be tested at its exact
// boundaries instead of relative to the wall clock. ProfileExists backs the
// recipe's NeedsProfile clause: the pipeline owns that clause, so the
// question has one owner instead of living half in the recipe and half in
// the mux.
type Options struct {
	Now func() time.Time
	// ProfileExists answers whether a key was onboarded. Required when a
	// recipe sets NeedsProfile; the pipeline answers 403 itself.
	ProfileExists func(publicB64 string) (bool, error)
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

// ParseRequest runs the shared pipeline for the recipe: version
// declaration, header presence and decoding, timestamp window, signature
// verification, body framing, replay rejection. A nil Error means the
// caller is cryptographically the profile it claims (the profile's
// existence is the store's business, not the wire's).
//
// The server speaks one protocol (ADR-0006): every request must carry
// `Protocol-Version: 2`, and the semantics are those of ADR-0003 —
// signatures bind the HTTP method and a per-request nonce, the timestamp
// window is one-sided with a 60 s future grace, and replay rejection covers
// GET/DELETE too.
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

	if got := r.Header.Get(HdrProtocolVersion); got != ProtocolVersion {
		return nil, errField(HdrProtocolVersion,
			HdrProtocolVersion+" must be "+ProtocolVersion)
	}

	p := &pending{}
	var timestamp, signature, nonce []byte

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

	// A signed request carries a nonce: it makes every signature unique, so
	// the replay cache never rejects a legitimate second request within the
	// same timestamp second. The requirement is derived from the recipe
	// (signed()) — a declared flag could be forgotten, and forgetting it
	// silently reintroduces the same-second collision.
	if rec.signed() {
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
		return parseSignedBody(r, g, p, rec, opts, now)
	}

	if err := checkTimestamp(timestamp, now); err != nil {
		return nil, err
	}

	// Recipes without HdrSignature (GET/DELETE /api/credentials/, the
	// unsigned quirk) skip verification; presence is enforced above when the
	// recipe lists the header. The method is bound into the signed message,
	// so a captured GET signature cannot be replayed as a DELETE.
	if signature != nil {
		msg := concat(concat([]byte(r.Method), timestamp), nonce)

		if err := verify(p.publicKey, msg, signature); err != nil {
			return nil, err
		}
	}

	// Replay rejection covers GET/DELETE too — signatures differ per request
	// (fresh timestamp + nonce), so a repeat sighting is a replay.
	if signature != nil &&
		g.RejectReplay(p.auth.PublicB64, replayBytes(signature, nonce)) {
		return nil, &Error{Status: http.StatusForbidden, Reason: "replayed request"}
	}

	return authed(p, rec, opts, timestamp, nonce)
}

// authed applies the recipe clauses that need the verified identity: the
// Profile-existence requirement. Before this lived here, `NeedsProfile` was
// declared in the recipe but enforced in the mux — one clause, two owners.
func authed(
	p *pending,
	rec Recipe,
	opts Options,
	timestamp, nonce []byte,
) (*Auth, *Error) {
	if !rec.NeedsProfile {
		return &p.auth, nil
	}

	if opts.ProfileExists == nil {
		// A programming error, not a protocol one: fail closed instead of
		// silently serving an endpoint without its profile check.
		return nil, &Error{Status: http.StatusInternalServerError}
	}

	exists, err := opts.ProfileExists(p.auth.PublicB64)
	if err != nil {
		return nil, &Error{Status: http.StatusInternalServerError}
	}

	if !exists {
		return nil, &Error{Status: http.StatusForbidden, Reason: "unknown profile"}
	}

	return &p.auth, nil
}

func parseSignedBody(
	r *http.Request,
	g *guard.Guard,
	p *pending,
	rec Recipe,
	opts Options,
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

	if err := checkTimestamp(tstamp, now); err != nil {
		return nil, err
	}

	msg := concat(concat(concat([]byte(r.Method), tstamp), p.nonce), payload)

	if err := verify(p.publicKey, msg, sig); err != nil {
		return nil, err
	}

	if g.RejectReplay(p.auth.PublicB64, sig) {
		return nil, &Error{Status: http.StatusForbidden, Reason: "replayed POST"}
	}

	p.auth.Payload = payload

	return authed(p, rec, opts, tstamp, p.nonce)
}

func checkTimestamp(raw []byte, now func() time.Time) *Error {
	if len(raw) != 4 {
		return errField(HdrTimestamp, "Malformed timestamp")
	}

	t := int64(binary.LittleEndian.Uint32(raw))
	d := now().Unix() - t

	// One-sided window with a 60 s future grace (ADR-0003 amendment):
	// ordinary client clock drift passes, pre-issued requests beyond the
	// grace stay rejected.
	bad := d > int64(TimestampTolerance/time.Second) ||
		d < -int64(FutureTolerance/time.Second)

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

// replayBytes is the replay-cache key material for header-signed requests:
// the signature already covers the nonce, concatenating keeps the call
// sites honest.
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
