package main

import (
	"crypto/rand"
	"embed"
	"encoding/base64"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"

	"passcryptum/internal/guard"
	"passcryptum/internal/store"
	"passcryptum/internal/wire"
)

//go:embed web
var webFS embed.FS

// One recipe per endpoint×method: the frozen v1 contract (ADR-0002) as data.
var (
	recProfilesGet = wire.Recipe{
		Headers: []string{wire.HdrPublicKey, wire.HdrTimestamp, wire.HdrSignature},
	}
	recProfilesPost = wire.Recipe{
		Headers:      []string{wire.HdrPublicKey},
		BodySigned:   true,
		NeedsProfile: true,
	}
	recProfilesDelete = recProfilesGet
	recCredentialsGet = wire.Recipe{
		// v1 quirk: unsigned — public key + factors + timestamp, no Signature.
		Headers: []string{wire.HdrPublicKey, wire.HdrHashedPin, wire.HdrProtector, wire.HdrTimestamp},
	}
	recCredentialsPost = wire.Recipe{
		Headers:      []string{wire.HdrPublicKey, wire.HdrHashedPin},
		BodySigned:   true,
		NeedsProfile: true,
	}
	recCredentialsDelete = wire.Recipe{
		Headers: []string{wire.HdrPublicKey, wire.HdrProtector, wire.HdrTimestamp},
	}
)

type server struct {
	st  *store.Store
	g   *guard.Guard
	now func() time.Time
}

func serve(st *store.Store, g *guard.Guard, addr string) error {
	s := &server{st: st, g: g, now: time.Now}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/profiles/", s.handleProfiles)
	mux.HandleFunc("/api/credentials/", s.handleCredentials)

	if web, err := fs.Sub(webFS, "web"); err == nil {
		mux.Handle("/", http.FileServer(http.FS(web)))
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           s.rateLimitAPI(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second, // slow-body connection-hold DoS
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	log.Printf("passcryptum listening on %s (db: %s)", addr, st.Path())

	return srv.ListenAndServe()
}

// rateLimitAPI applies the per-IP sliding window to the API only —
// static assets are not limited.
func (s *server) rateLimitAPI(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && !s.g.AllowIP(guard.ClientIP(r)) {
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *server) handleProfiles(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.profilesGet(w, r)
	case http.MethodPost:
		s.profilesPost(w, r)
	case http.MethodDelete:
		s.profilesDelete(w, r)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed) // hardened: reference 500s here
	}
}

func (s *server) handleCredentials(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.credentialsGet(w, r)
	case http.MethodPost:
		s.credentialsPost(w, r)
	case http.MethodDelete:
		s.credentialsDelete(w, r)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed) // hardened: reference 500s here
	}
}

// answer is what a domain function produces: a body to send with 200, or a
// denial carrying the audit reason. Statuses that are not 200 are the
// pipeline's business, so no handler writes headers itself.
type answer struct {
	body      string
	noContent bool   // 204: the resource exists but holds nothing
	denied    string // non-empty: 403 with this reason
}

func ok(body string) answer     { return answer{body: body} }
func denied(why string) answer  { return answer{denied: why} }
func okEmpty() answer           { return answer{} }
func (a answer) isDenied() bool { return a.denied != "" }

// endpoint is a handler with the wire concerns removed.
type endpoint func(auth *wire.Auth) (answer, *wire.Error)

// handle runs one endpoint: parse and verify the request, enforce the
// recipe's profile requirement, run the domain function, and write exactly
// one response. Domain denials (403) go through writeDenied here; the wire
// pipeline's own denials (replay) come back as an error and are written by
// writeWireError.
func (s *server) handle(
	w http.ResponseWriter,
	r *http.Request,
	rec wire.Recipe,
	fn endpoint,
) {
	auth, e := wire.ParseRequestWith(r, s.g, rec, wire.Options{Now: s.now})
	if e != nil {
		s.writeWireError(w, r, e)

		return
	}

	if rec.NeedsProfile {
		exists, err := s.st.ProfileExists(auth.PublicB64)
		if err != nil {
			log.Printf("db error: %v", err)
			w.WriteHeader(http.StatusInternalServerError)

			return
		}

		if !exists {
			s.writeDenied(w, r, auth.PublicB64, "unknown profile")

			return
		}
	}

	result, e := fn(auth)
	if e != nil {
		s.writeWireError(w, r, e)

		return
	}

	if result.isDenied() {
		s.writeDenied(w, r, auth.PublicB64, result.denied)

		return
	}

	if result.noContent {
		w.WriteHeader(http.StatusNoContent)

		return
	}

	if result.body == "" {
		w.WriteHeader(http.StatusOK)

		return
	}

	wire.WriteJSONString(w, result.body)
}

func (s *server) profilesGet(w http.ResponseWriter, r *http.Request) {
	s.handle(w, r, recProfilesGet, func(auth *wire.Auth) (answer, *wire.Error) {
		services, found, err := s.st.GetServices(auth.PublicB64)
		if err != nil {
			s.dbFailure(err)

			return answer{}, errInternal
		}

		if !found {
			return denied("unknown profile"), nil
		}

		if services == nil {
			return answer{noContent: true}, nil
		}

		return ok(*services), nil
	})
}

func (s *server) profilesPost(w http.ResponseWriter, r *http.Request) {
	s.handle(w, r, recProfilesPost, func(auth *wire.Auth) (answer, *wire.Error) {
		if _, err := s.st.SetServices(
			auth.PublicB64,
			base64.StdEncoding.EncodeToString(auth.Payload),
		); err != nil {
			s.dbFailure(err)

			return answer{}, errInternal
		}

		return okEmpty(), nil
	})
}

func (s *server) profilesDelete(w http.ResponseWriter, r *http.Request) {
	s.handle(w, r, recProfilesDelete, func(auth *wire.Auth) (answer, *wire.Error) {
		cleared, found, err := s.st.ClearServices(auth.PublicB64)
		if err != nil {
			s.dbFailure(err)

			return answer{}, errInternal
		}

		if !found {
			return denied("unknown profile"), nil
		}

		if !cleared {
			return answer{noContent: true}, nil
		}

		return okEmpty(), nil
	})
}

func (s *server) credentialsGet(w http.ResponseWriter, r *http.Request) {
	s.handle(w, r, recCredentialsGet, func(auth *wire.Auth) (answer, *wire.Error) {
		// Lockout gate: refuse without consulting the db while the profile
		// is over the failure budget.
		if s.g.Locked(auth.PublicB64) {
			return denied("profile locked (auth failures)"), nil
		}

		// Failure counters only grow for KNOWN profiles: counting unknown
		// keys would let anyone inflate the map and the log.
		exists, err := s.st.ProfileExists(auth.PublicB64)
		if err != nil {
			s.dbFailure(err)

			return answer{}, errInternal
		}

		if !exists {
			return denied("unknown profile"), nil
		}

		entropy, found, err := s.st.GetCredential(
			auth.PublicB64, auth.HashedPin, auth.Protector,
		)
		if err != nil {
			s.dbFailure(err)

			return answer{}, errInternal
		}

		if !found {
			if s.g.NoteFailure(auth.PublicB64) {
				log.Printf("profile %.8s... locked out (auth failures)", auth.PublicB64)
			}

			return denied("credential auth failed"), nil
		}

		s.g.ClearFailures(auth.PublicB64)

		return ok(entropy), nil
	})
}

func (s *server) credentialsPost(w http.ResponseWriter, r *http.Request) {
	s.handle(w, r, recCredentialsPost, func(auth *wire.Auth) (answer, *wire.Error) {
		protector := make([]byte, 32)
		if _, err := rand.Read(protector); err != nil { // must be unpredictable
			s.dbFailure(err)

			return answer{}, errInternal
		}

		protectorB64 := base64.StdEncoding.EncodeToString(protector)

		if err := s.st.CreateCredential(
			auth.PublicB64,
			auth.HashedPin,
			protectorB64,
			base64.StdEncoding.EncodeToString(auth.Payload),
		); err != nil {
			s.dbFailure(err)

			return answer{}, errInternal
		}

		return ok(protectorB64), nil
	})
}

func (s *server) credentialsDelete(w http.ResponseWriter, r *http.Request) {
	s.handle(w, r, recCredentialsDelete, func(auth *wire.Auth) (answer, *wire.Error) {
		deleted, err := s.st.DeleteCredential(auth.PublicB64, auth.Protector)
		if err != nil {
			s.dbFailure(err)

			return answer{}, errInternal
		}

		if !deleted {
			return denied("unknown credential"), nil
		}

		return okEmpty(), nil
	})
}

// errInternal is the only 500 the domain functions produce; the failure
// itself is logged by dbFailure so the response stays opaque.
var errInternal = &wire.Error{Status: http.StatusInternalServerError}

func (s *server) dbFailure(err error) {
	log.Printf("db error: %v", err)
}

// writeWireError writes a wire-level failure and logs denials that carry a
// reason (the replay 403 would otherwise lose its audit line).
func (s *server) writeWireError(w http.ResponseWriter, r *http.Request, e *wire.Error) {
	if e.Reason != "" {
		log.Printf(
			"denied %s %s ip=%s pub=%.8s... reason=%s",
			r.Method, r.URL.Path, guard.ClientIP(r), r.Header.Get(wire.HdrPublicKey), e.Reason,
		)
	}

	e.Write(w)
}

// writeDenied is the single owner of the contract's most repeated status.
func (s *server) writeDenied(w http.ResponseWriter, r *http.Request, pub, why string) {
	log.Printf(
		"denied %s %s ip=%s pub=%.8s... reason=%s",
		r.Method, r.URL.Path, guard.ClientIP(r), pub, why,
	)

	w.WriteHeader(http.StatusForbidden)
}
