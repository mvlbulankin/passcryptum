package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"time"

	"passcryptum/internal/guard"
	"passcryptum/internal/store"
	"passcryptum/internal/wire"
)

func usage() {
	usage := `usage:
  passcryptum serve <addr>            e.g. :8000 or 127.0.0.1:8777
  passcryptum genkey                  print a fresh ed25519 keypair (b64)
  passcryptum add-public-key <base64-ed25519-public-key>
  passcryptum delete-public-key <base64-ed25519-public-key>

env: PC_DB (default passcryptum.db)
     PC_RATE_PER_MIN (default 300), PC_PROFILE_FAIL_MAX (default 100)`
	fmt.Fprintln(os.Stderr, usage)
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	dbPath := envOr("PC_DB", "passcryptum.db")
	st, err := store.Open(dbPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	defer st.Close()

	switch os.Args[1] {
	case "genkey":
		_, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
		fmt.Printf("seed(private): %s\n", base64.StdEncoding.EncodeToString(priv.Seed()))
		fmt.Printf("public:         %s\n", base64.StdEncoding.EncodeToString(priv.Public().(ed25519.PublicKey)))
		fmt.Fprintln(os.Stderr, "pass <public> to add-public-key; the seed is needed for contract tests (PC_PRIVATE_SEED)")
	case "serve":
		addr := ":8000"
		if len(os.Args) >= 3 {
			addr = os.Args[2]
		}

		g := guard.New(
			envIntOr("PC_RATE_PER_MIN", 300),
			envIntOr("PC_PROFILE_FAIL_MAX", 100),
			2*wire.TimestampTolerance,
			time.Now,
		)

		if err := serve(st, g, addr); err != nil {
			fmt.Fprintln(os.Stderr, "serve:", err)
			os.Exit(1)
		}
	case "add-public-key", "delete-public-key":
		if len(os.Args) != 3 {
			usage()
			os.Exit(2)
		}
		pub := os.Args[2]
		if raw, err := base64.StdEncoding.DecodeString(pub); err != nil || len(raw) != ed25519.PublicKeySize {
			fmt.Fprintf(os.Stderr, "error: key must be base64 of a 32-byte ed25519 public key\n")
			os.Exit(2)
		}
		if os.Args[1] == "add-public-key" {
			created, err := st.AddPublicKey(pub)
			if err != nil {
				fmt.Fprintln(os.Stderr, "error:", err)
				os.Exit(1)
			}
			if created {
				fmt.Printf("Public key %q added\n", pub)
			} else {
				fmt.Printf("Public key %q already exists\n", pub)
			}
			return
		}
		deleted, err := st.DeletePublicKey(pub)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
		if deleted {
			fmt.Printf("Public key %q deleted\n", pub)
		} else {
			fmt.Printf("Public key %q not found\n", pub)
		}
	default:
		usage()
		os.Exit(2)
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}

	return def
}

func envIntOr(k string, def int) int {
	var v int
	if _, err := fmt.Sscanf(os.Getenv(k), "%d", &v); err != nil || v <= 0 {
		return def
	}

	return v
}
