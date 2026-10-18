// Package store is the SQLite persistence for Profile and Credential rows
// (ADR-0002). All SQL lives here; the server speaks only in domain calls.
package store

import (
	"crypto/sha512"
	"database/sql"
	"encoding/base64"
	"fmt"
	"time"

	"crypto/pbkdf2"

	_ "modernc.org/sqlite"
)

// The profile is identified by its public key (the primary key);
// credentials reference it with cascade deletion.
const schema = `
CREATE TABLE IF NOT EXISTS profiles (
    public_key TEXT PRIMARY KEY,
    services   TEXT
);
CREATE TABLE IF NOT EXISTS credentials (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL REFERENCES profiles(public_key) ON DELETE CASCADE,
    pin        TEXT NOT NULL,
    protector  TEXT NOT NULL,
    entropy    TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS credential_profile_idx ON credentials(profile_id);
`

const maxCredentialsPerProfile = 10

type Store struct {
	db   *sql.DB
	path string
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(1) // single writer for SQLite

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return &Store{db: db, path: path}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// Path reports the database file location (for the startup log).
func (s *Store) Path() string { return s.path }

// nowStamp is a sortable fixed-format UTC stamp; created_at ordering
// drives the eviction semantics.
func nowStamp() string {
	return time.Now().UTC().Format("2006-01-02 15:04:05.000000")
}

// hashPin stretches the received Hashed-Pin value (b64 text on the wire)
// with PBKDF2-SHA512, salted by the credential's protector, so a leaked
// database is not a PIN dictionary.
// 600k iterations ≈ 150 ms per auth — it is the online-guessing oracle too.
func hashPin(pinB64, protectorB64 string) (string, error) {
	key, err := pbkdf2.Key(sha512.New, pinB64, []byte(protectorB64), pinIterations, 32)
	if err != nil {
		return "", err
	}

	return base64.StdEncoding.EncodeToString(key), nil
}

const pinIterations = 600_000

func rowsAffected(res sql.Result) bool {
	n, _ := res.RowsAffected()

	return n > 0
}

func (s *Store) AddPublicKey(pub string) (bool, error) {
	res, err := s.db.Exec("INSERT OR IGNORE INTO profiles (public_key) VALUES (?)", pub)
	if err != nil {
		return false, fmt.Errorf("add public key: %w", err)
	}

	return rowsAffected(res), nil
}

func (s *Store) DeletePublicKey(pub string) (bool, error) {
	res, err := s.db.Exec("DELETE FROM profiles WHERE public_key = ?", pub)
	if err != nil {
		return false, fmt.Errorf("delete public key: %w", err)
	}

	return rowsAffected(res), nil
}

// GetServices: found=false means unknown profile; services.Valid means the
// profile has a services blob.
func (s *Store) GetServices(pub string) (services sql.NullString, found bool, err error) {
	err = s.db.QueryRow("SELECT services, 1 FROM profiles WHERE public_key = ?", pub).Scan(&services, &found)
	if err == sql.ErrNoRows {
		return services, false, nil
	}

	return services, found, err
}

func (s *Store) SetServices(pub, servicesB64 string) (bool, error) {
	res, err := s.db.Exec("UPDATE profiles SET services = ? WHERE public_key = ?", servicesB64, pub)
	if err != nil {
		return false, fmt.Errorf("set services: %w", err)
	}

	return rowsAffected(res), nil
}

// ClearServices: found=false unknown profile; cleared=false profile without services.
// Single conditional UPDATE — no check-then-clear race (a concurrent
// SetServices either lands before (and is cleared) or after (and survives).
func (s *Store) ClearServices(pub string) (cleared bool, found bool, err error) {
	res, err := s.db.Exec(
		"UPDATE profiles SET services = NULL WHERE public_key = ? AND services IS NOT NULL", pub)
	if err != nil {
		return false, false, fmt.Errorf("clear services: %w", err)
	}

	if n, _ := res.RowsAffected(); n > 0 {
		return true, true, nil
	}

	// Nothing cleared: unknown profile, or known profile with no blob.
	err = s.db.QueryRow("SELECT 1 FROM profiles WHERE public_key = ?", pub).Scan(&found)
	if err == sql.ErrNoRows {
		return false, false, nil
	}

	if err != nil {
		return false, false, fmt.Errorf("clear services: %w", err)
	}

	return false, found, nil
}

// CreateCredential inserts and evicts the oldest when at capacity.
func (s *Store) CreateCredential(pub, pinB64, protectorB64, entropyB64 string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}

	defer tx.Rollback()

	var count int
	if err := tx.QueryRow("SELECT COUNT(*) FROM credentials WHERE profile_id = ?", pub).Scan(&count); err != nil {
		return err
	}

	if count >= maxCredentialsPerProfile {
		if _, err := tx.Exec(`DELETE FROM credentials WHERE id =
			(SELECT id FROM credentials WHERE profile_id = ? ORDER BY created_at ASC, id ASC LIMIT 1)`, pub); err != nil {
			return err
		}
	}

	// Store the re-hash, never the received pin verbatim.
	pinHash, err := hashPin(pinB64, protectorB64)
	if err != nil {
		return err
	}

	_, err = tx.Exec(`INSERT INTO credentials (profile_id, pin, protector, entropy, created_at)
		VALUES (?, ?, ?, ?, ?)`, pub, pinHash, protectorB64, entropyB64, nowStamp())
	if err != nil {
		return err
	}

	return tx.Commit()
}

// GetCredential: with pinB64=="" the pin factor is not checked (the DELETE
// path, a protocol quirk). Otherwise the row is fetched by (profile,
// protector) and the pin is compared against BOTH formats: a legacy
// verbatim match (legacy row) is upgraded to the re-hash in place; a
// re-hash match authenticates directly. Returns entropy (b64 text).
func (s *Store) GetCredential(pub, pinB64, protectorB64 string) (entropy string, found bool, err error) {
	if pinB64 == "" {
		return s.getCredentialNoPin(pub, protectorB64)
	}

	var stored, ent sql.NullString
	err = s.db.QueryRow(
		"SELECT pin, entropy FROM credentials WHERE profile_id = ? AND protector = ?",
		pub, protectorB64,
	).Scan(&stored, &ent)
	if err == sql.ErrNoRows {
		return "", false, nil
	} else if err != nil {
		return "", false, fmt.Errorf("get credential: %w", err)
	}

	if stored.String == pinB64 {
		// Legacy verbatim match: rewrite as a re-hash (lazy migration).
		pinHash, err := hashPin(pinB64, protectorB64)
		if err != nil {
			return "", false, err
		}

		if _, err := s.db.Exec(
			"UPDATE credentials SET pin = ? WHERE profile_id = ? AND protector = ?",
			pinHash, pub, protectorB64,
		); err != nil {
			return "", false, err
		}

		return ent.String, true, nil
	}

	pinHash, err := hashPin(pinB64, protectorB64)
	if err != nil {
		return "", false, err
	}

	if stored.String == pinHash {
		return ent.String, true, nil
	}

	return "", false, nil
}

func (s *Store) getCredentialNoPin(pub, protectorB64 string) (entropy string, found bool, err error) {
	var e sql.NullString
	if err := s.db.QueryRow(
		"SELECT entropy FROM credentials WHERE profile_id = ? AND protector = ?",
		pub, protectorB64,
	).Scan(&e); err == sql.ErrNoRows {
		return "", false, nil
	} else if err != nil {
		return "", false, err
	}

	return e.String, true, nil
}

func (s *Store) DeleteCredential(pub, protectorB64 string) (bool, error) {
	res, err := s.db.Exec("DELETE FROM credentials WHERE profile_id = ? AND protector = ?", pub, protectorB64)
	if err != nil {
		return false, fmt.Errorf("delete credential: %w", err)
	}

	return rowsAffected(res), nil
}
