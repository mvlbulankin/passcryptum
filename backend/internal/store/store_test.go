package store

import (
	"fmt"
	"testing"
)

func openMemory(t *testing.T) *Store {
	t.Helper()

	s, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open :memory:: %v", err)
	}

	t.Cleanup(func() { s.Close() })

	return s
}

func TestPublicKeyLifecycle(t *testing.T) {
	s := openMemory(t)

	created, err := s.AddPublicKey("pub-A")
	if err != nil || !created {
		t.Fatalf("first add: created=%v err=%v", created, err)
	}

	created, err = s.AddPublicKey("pub-A")
	if err != nil || created {
		t.Fatalf("second add must be idempotent: created=%v err=%v", created, err)
	}

	deleted, err := s.DeletePublicKey("pub-A")
	if err != nil || !deleted {
		t.Fatalf("delete existing: deleted=%v err=%v", deleted, err)
	}

	deleted, err = s.DeletePublicKey("pub-A")
	if err != nil || deleted {
		t.Fatalf("delete missing: deleted=%v err=%v", deleted, err)
	}
}

func TestServicesRoundTrip(t *testing.T) {
	s := openMemory(t)
	s.AddPublicKey("pub-A")

	// Unknown profile is reported through found.
	if _, found, _ := s.GetServices("pub-B"); found {
		t.Fatal("unknown profile must not be found")
	}

	services, found, _ := s.GetServices("pub-A")
	if !found || services.Valid {
		t.Fatalf("fresh profile: found=%v valid=%v, want true/false", found, services.Valid)
	}

	if ok, _ := s.SetServices("pub-A", "YmxvYg=="); !ok {
		t.Fatal("set on known profile must succeed")
	}

	if ok, _ := s.SetServices("pub-B", "YmxvYg=="); ok {
		t.Fatal("set on unknown profile must not change anything")
	}

	services, found, _ = s.GetServices("pub-A")
	if !found || !services.Valid || services.String != "YmxvYg==" {
		t.Fatalf("round-trip failed: %+v found=%v", services, found)
	}

	cleared, found, _ := s.ClearServices("pub-A")
	if !cleared || !found {
		t.Fatalf("clear with blob: cleared=%v found=%v", cleared, found)
	}

	cleared, found, _ = s.ClearServices("pub-A")
	if cleared || !found {
		t.Fatalf("clear without blob: cleared=%v found=%v (204 semantics)", cleared, found)
	}
}

func TestCredentialLifecycleAndQuirks(t *testing.T) {
	s := openMemory(t)
	s.AddPublicKey("pub-A")

	if err := s.CreateCredential("pub-A", "cGFpbg==", "cHJvdA==", "ZW50cg=="); err != nil {
		t.Fatalf("create: %v", err)
	}

	entropy, found, _ := s.GetCredential("pub-A", "cGFpbg==", "cHJvdA==")
	if !found || entropy != "ZW50cg==" {
		t.Fatalf("get with matching pin: entropy=%q found=%v", entropy, found)
	}

	if _, found, _ := s.GetCredential("pub-A", "V1JPTkQ=", "cHJvdA=="); found {
		t.Fatal("wrong pin must not be found")
	}

	// v1 quirk: pinB64 == "" skips the pin factor (the DELETE path).
	if _, found, _ := s.GetCredential("pub-A", "", "cHJvdA=="); !found {
		t.Fatal("empty pin must skip the pin factor")
	}

	if _, found, _ := s.GetCredential("pub-A", "", "Tk9QRQ=="); found {
		t.Fatal("wrong protector must not be found")
	}

	deleted, _ := s.DeleteCredential("pub-A", "cHJvdA==")
	if !deleted {
		t.Fatal("delete must succeed")
	}

	if _, found, _ := s.GetCredential("pub-A", "cGFpbg==", "cHJvdA=="); found {
		t.Fatal("deleted credential must be gone")
	}
}

func TestCredentialEvictionOldestFirst(t *testing.T) {
	s := openMemory(t)
	s.AddPublicKey("pub-A")

	for i := 0; i < maxCredentialsPerProfile+1; i++ {
		if err := s.CreateCredential("pub-A", "cGFpbg==", protectorOf(i), entropyOf(i)); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}

	// The oldest was evicted by the 11th create.
	if _, found, _ := s.GetCredential("pub-A", "", protectorOf(0)); found {
		t.Fatal("oldest credential must be evicted at capacity")
	}

	var count int
	s.db.QueryRow("SELECT COUNT(*) FROM credentials WHERE profile_id = ?", "pub-A").Scan(&count)
	if count != maxCredentialsPerProfile {
		t.Fatalf("count = %d, want %d", count, maxCredentialsPerProfile)
	}

	// The newest is still there.
	if _, found, _ := s.GetCredential("pub-A", "", protectorOf(maxCredentialsPerProfile)); !found {
		t.Fatal("newest credential must survive eviction")
	}
}

func protectorOf(i int) string { return fmt.Sprintf("protector-%02d", i) }

func entropyOf(i int) string { return fmt.Sprintf("entropy-%02d", i) }

func TestCredentialPinIsStoredAsRehashNotRaw(t *testing.T) {
	s := openMemory(t)
	s.AddPublicKey("pub-A")

	if err := s.CreateCredential("pub-A", "cGFpbg==", "cHJvdA==", "ZW50cg=="); err != nil {
		t.Fatalf("create: %v", err)
	}

	var stored string
	s.db.QueryRow("SELECT pin FROM credentials WHERE profile_id = ? AND protector = ?", "pub-A", "cHJvdA==").Scan(&stored)
	if stored == "cGFpbg==" {
		t.Fatal("the raw received pin must never be stored verbatim")
	}
	if stored == "" {
		t.Fatal("pin column must be populated")
	}

	// The correct pin still authenticates; a wrong one does not.
	if _, found, _ := s.GetCredential("pub-A", "cGFpbg==", "cHJvdA=="); !found {
		t.Fatal("correct pin must authenticate against the rehash")
	}
	if _, found, _ := s.GetCredential("pub-A", "V1JPTkQ=", "cHJvdA=="); found {
		t.Fatal("wrong pin must not authenticate")
	}
}

func TestLegacyRawPinUpgradesLazily(t *testing.T) {
	s := openMemory(t)
	s.AddPublicKey("pub-A")

	// Simulate a legacy row: the original code stored the pin verbatim.
	_, err := s.db.Exec(
		"INSERT INTO credentials (profile_id, pin, protector, entropy, created_at) VALUES (?, ?, ?, ?, ?)",
		"pub-A", "cGFpbg==", "cHJvdA==", "ZW50cg==", "2020-01-01 00:00:00.000000",
	)
	if err != nil {
		t.Fatalf("seed legacy row: %v", err)
	}

	entropy, found, err := s.GetCredential("pub-A", "cGFpbg==", "cHJvdA==")
	if err != nil || !found || entropy != "ZW50cg==" {
		t.Fatalf("legacy credential must authenticate: found=%v entropy=%q err=%v", found, entropy, err)
	}

	var stored string
	s.db.QueryRow("SELECT pin FROM credentials WHERE profile_id = ? AND protector = ?", "pub-A", "cHJvdA==").Scan(&stored)
	if stored == "cGFpbg==" {
		t.Fatal("successful legacy auth must rewrite the pin as a rehash")
	}

	// And the upgraded row still authenticates on the next request.
	if _, found, _ := s.GetCredential("pub-A", "cGFpbg==", "cHJvdA=="); !found {
		t.Fatal("upgraded credential must keep authenticating")
	}
}
