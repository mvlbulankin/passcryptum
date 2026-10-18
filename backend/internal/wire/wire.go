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
)

// TimestampTolerance is the protocol's ±300 s request window (ADR-0002).
const TimestampTolerance = 300 * time.Second

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
}

// Auth is the verified request identity plus any payload the recipe carried.
type Auth struct {
	PublicKey ed25519.PublicKey
	PublicB64 string
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

	// Reason carries a loggable denial cause for non-400 statuses (e.g. the
	// replay 403), so the server can emit its audit line.
	Reason string
}

func errField(field, msg string) *Error {
	return &Error{Status: http.StatusBadRequest, Field: field, Msg: msg}
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
	auth := &Auth{}
	var timestamp, signature []byte
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

			auth.PublicKey = ed25519.PublicKey(raw)
			auth.PublicB64 = v
		case HdrHashedPin:
			auth.HashedPin = v
		case HdrProtector:
			auth.Protector = v
		case HdrTimestamp:
			timestamp = raw
		case HdrSignature:
			signature = raw
		}
	}

	if rec.BodySigned {
		return parseSignedBody(r, g, auth, v2)
	}

	if err := checkTimestamp(timestamp, v2); err != nil {
		return nil, err
	}

	// Recipes without HdrSignature (GET/DELETE /api/credentials/, the v1
	// unsigned quirk) skip verification; presence of the header is enforced
	// above when the recipe lists it. v2 binds the method into the signed
	// message, so a captured GET signature cannot be replayed as a DELETE.
	if signature != nil {
		msg := timestamp

		if v2 {
			msg = concat([]byte(r.Method), timestamp)
		}

		if err := verify(auth.PublicKey, msg, signature); err != nil {
			return nil, err
		}
	}

	// v2: replay rejection covers GET/DELETE too — signatures now differ per
	// request (fresh timestamp), so a repeat sighting is a replayed capture.
	// Unsigned recipes have no signature to key on (and none to replay).
	if v2 && signature != nil && g.RejectReplay(auth.PublicB64, signature) {
		return nil, &Error{Status: http.StatusForbidden, Reason: "replayed request"}
	}

	return auth, nil
}

func parseSignedBody(r *http.Request, g *guard.Guard, auth *Auth, v2 bool) (*Auth, *Error) {
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

	if err := checkTimestamp(tstamp, v2); err != nil {
		return nil, err
	}

	msg := concat(tstamp, payload)

	if v2 {
		msg = concat([]byte(r.Method), msg)
	}

	if err := verify(auth.PublicKey, msg, sig); err != nil {
		return nil, err
	}

	if g.RejectReplay(auth.PublicB64, sig) {
		return nil, &Error{Status: http.StatusForbidden, Reason: "replayed POST"}
	}

	auth.Payload = payload

	return auth, nil
}

func checkTimestamp(raw []byte, oneSided bool) *Error {
	if len(raw) != 4 {
		return errField(HdrTimestamp, "Malformed timestamp")
	}

	t := int64(binary.LittleEndian.Uint32(raw))
	now := time.Now().Unix()
	d := now - t

	// v1: symmetric ±300 s (pre-issued requests accepted — pinned quirk).
	// v2: one-sided 0 <= now-ts <= 300 — a timestamp from the future is
	// rejected, killing the pre-issued replay form.
	bad := d > int64(TimestampTolerance/time.Second) ||
		(oneSided && d < 0) ||
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
