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
		Headers:    []string{wire.HdrPublicKey},
		BodySigned: true,
	}
	recProfilesDelete = recProfilesGet
	recCredentialsGet = wire.Recipe{
		// v1 quirk: unsigned — public key + factors + timestamp, no Signature.
		Headers: []string{wire.HdrPublicKey, wire.HdrHashedPin, wire.HdrProtector, wire.HdrTimestamp},
	}
	recCredentialsPost = wire.Recipe{
		Headers:    []string{wire.HdrPublicKey, wire.HdrHashedPin},
		BodySigned: true,
	}
	recCredentialsDelete = wire.Recipe{
		Headers: []string{wire.HdrPublicKey, wire.HdrProtector, wire.HdrTimestamp},
	}
)

type server struct {
	st *store.Store
	g  *guard.Guard
}

func serve(st *store.Store, g *guard.Guard, addr string) error {
	s := &server{st: st, g: g}

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

func (s *server) profilesGet(w http.ResponseWriter, r *http.Request) {
	auth, e := wire.ParseRequest(r, s.g, recProfilesGet)
	if e != nil {
		e.Write(w)
		return
	}

	services, found, err := s.st.GetServices(auth.PublicB64)
	if err != nil {
		dbError(w, err)
		return
	}

	if !found {
		s.logDenied(r, auth, "unknown profile")
		w.WriteHeader(http.StatusForbidden)
		return
	}

	if !services.Valid {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	wire.WriteJSONString(w, services.String)
}

func (s *server) profilesPost(w http.ResponseWriter, r *http.Request) {
	auth, e := wire.ParseRequest(r, s.g, recProfilesPost)
	if e != nil {
		s.writeWireError(w, r, e)
		return
	}

	if !s.profileExists(auth.PublicB64, w) {
		return
	}

	servicesB64 := base64.StdEncoding.EncodeToString(auth.Payload)

	if _, err := s.st.SetServices(auth.PublicB64, servicesB64); err != nil {
		dbError(w, err)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (s *server) profilesDelete(w http.ResponseWriter, r *http.Request) {
	auth, e := wire.ParseRequest(r, s.g, recProfilesDelete)
	if e != nil {
		e.Write(w)
		return
	}

	cleared, found, err := s.st.ClearServices(auth.PublicB64)
	if err != nil {
		dbError(w, err)
		return
	}

	if !found {
		w.WriteHeader(http.StatusForbidden)
		return
	}

	if !cleared {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (s *server) credentialsGet(w http.ResponseWriter, r *http.Request) {
	auth, e := wire.ParseRequest(r, s.g, recCredentialsGet)
	if e != nil {
		e.Write(w)
		return
	}

	// Lockout gate: refuse without consulting the db while the profile is
	// over the failure budget.
	if s.g.Locked(auth.PublicB64) {
		s.logDenied(r, auth, "profile locked (auth failures)")
		w.WriteHeader(http.StatusForbidden)
		return
	}

	// Failure counters only grow for KNOWN profiles: counting unknown keys
	// too would let anyone grow the failures map (and the log) with fresh
	// random Public-Keys.
	if _, found, err := s.st.GetServices(auth.PublicB64); err != nil {
		dbError(w, err)
		return
	} else if !found {
		s.logDenied(r, auth, "unknown profile")
		w.WriteHeader(http.StatusForbidden)
		return
	}

	entropy, found, err := s.st.GetCredential(auth.PublicB64, auth.HashedPin, auth.Protector)
	if err != nil {
		dbError(w, err)
		return
	}

	if !found {
		s.logDenied(r, auth, "credential auth failed")

		if s.g.NoteFailure(auth.PublicB64) {
			log.Printf("profile %.8s... locked out (auth failures)", auth.PublicB64)
		}

		w.WriteHeader(http.StatusForbidden)
		return
	}

	s.g.ClearFailures(auth.PublicB64)
	wire.WriteJSONString(w, entropy)
}

func (s *server) credentialsPost(w http.ResponseWriter, r *http.Request) {
	auth, e := wire.ParseRequest(r, s.g, recCredentialsPost)
	if e != nil {
		s.writeWireError(w, r, e)
		return
	}

	if !s.profileExists(auth.PublicB64, w) {
		return
	}

	protector := make([]byte, 32)
	if _, err := rand.Read(protector); err != nil { // must be unpredictable
		log.Printf("rng error: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	protectorB64 := base64.StdEncoding.EncodeToString(protector)
	entropyB64 := base64.StdEncoding.EncodeToString(auth.Payload)

	if err := s.st.CreateCredential(auth.PublicB64, auth.HashedPin, protectorB64, entropyB64); err != nil {
		dbError(w, err)
		return
	}

	wire.WriteJSONString(w, protectorB64)
}

func (s *server) credentialsDelete(w http.ResponseWriter, r *http.Request) {
	auth, e := wire.ParseRequest(r, s.g, recCredentialsDelete)
	if e != nil {
		e.Write(w)
		return
	}

	deleted, err := s.st.DeleteCredential(auth.PublicB64, auth.Protector)
	if err != nil {
		dbError(w, err)
		return
	}

	if !deleted {
		w.WriteHeader(http.StatusForbidden)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// profileExists answers the 403-for-unknown-profile part of the contract.
func (s *server) profileExists(pubB64 string, w http.ResponseWriter) bool {
	_, found, err := s.st.GetServices(pubB64)
	if err != nil {
		dbError(w, err)
		return false
	}

	if !found {
		w.WriteHeader(http.StatusForbidden)
		return false
	}

	return true
}

// writeWireError writes the wire failure and logs the denials that carry a
// reason (the replay 403 lost its audit line when it moved into wire).
func (s *server) writeWireError(w http.ResponseWriter, r *http.Request, e *wire.Error) {
	if e.Reason != "" {
		log.Printf(
			"denied %s %s ip=%s pub=%.8s... reason=%s",
			r.Method, r.URL.Path, guard.ClientIP(r), r.Header.Get(wire.HdrPublicKey), e.Reason,
		)
	}

	e.Write(w)
}

func dbError(w http.ResponseWriter, err error) {
	log.Printf("db error: %v", err)
	w.WriteHeader(http.StatusInternalServerError)
}

func (s *server) logDenied(r *http.Request, auth *wire.Auth, why string) {
	log.Printf(
		"denied %s %s ip=%s pub=%.8s... reason=%s",
		r.Method, r.URL.Path, guard.ClientIP(r), auth.PublicB64, why,
	)
}
