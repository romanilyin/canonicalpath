package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func privateTestParent(t *testing.T) string {
	t.Helper()
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	protectTestParent(t, parent)
	return parent
}

func TestBootstrapCreatesPrivateMatchingCredentials(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "localhost", "::1"} {
		t.Run(host, func(t *testing.T) {
			parent := privateTestParent(t)
			outputDir := filepath.Join(parent, "launch")
			listen := "127.0.0.1:8765"
			if host == "::1" {
				listen = "[::1]:8765"
			}
			var output bytes.Buffer
			if err := run([]string{"-out-dir", outputDir, "-host", host, "-listen", listen}, &output); err != nil {
				t.Fatal(err)
			}
			root, err := os.OpenRoot(outputDir)
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			if err := validateDirectory(root, true); err != nil {
				t.Fatal(err)
			}
			files := make(map[string][]byte)
			for _, name := range []string{"ca.pem", "certificate.pem", "key.pem", "token", "connection.json"} {
				file, err := root.Open(name)
				if err != nil {
					t.Fatal(err)
				}
				info, err := file.Stat()
				if err != nil {
					t.Fatal(err)
				}
				if err := validateAccess(file, info, true); err != nil {
					t.Fatalf("%s is not private: %v", name, err)
				}
				_ = file.Close()
				files[name], err = root.ReadFile(name)
				if err != nil {
					t.Fatal(err)
				}
			}
			var config connection
			if err := json.Unmarshal(files["connection.json"], &config); err != nil {
				t.Fatal(err)
			}
			expectedEndpoint, _ := bootstrapEndpoint(host, listen)
			if config.Version != 1 || config.Endpoint != expectedEndpoint || config.CACertificatePEM != string(files["ca.pem"]) {
				t.Fatal("bootstrap connection metadata mismatch")
			}
			decodedToken, err := hex.DecodeString(config.Token)
			if err != nil || len(decodedToken) != 32 || strings.TrimSpace(string(files["token"])) != config.Token {
				t.Fatal("bootstrap token is not a matching 256-bit capability")
			}
			if strings.Contains(output.String(), config.Token) || strings.Contains(output.String(), "PRIVATE KEY") || strings.Contains(output.String(), "CERTIFICATE") {
				t.Fatal("bootstrap printed credential contents")
			}
			pair, err := tls.X509KeyPair(files["certificate.pem"], files["key.pem"])
			if err != nil {
				t.Fatal(err)
			}
			leaf, err := x509.ParseCertificate(pair.Certificate[0])
			if err != nil {
				t.Fatal(err)
			}
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM(files["ca.pem"]) {
				t.Fatal("cannot load bootstrap CA")
			}
			if _, err := leaf.Verify(x509.VerifyOptions{Roots: pool, DNSName: host}); err != nil {
				t.Fatal(err)
			}
			if leaf.NotAfter.After(time.Now().Add(24*time.Hour)) || leaf.IsCA {
				t.Fatal("bootstrap leaf has an excessive lifetime or CA authority")
			}
			fingerprint := sha256.Sum256(leaf.Raw)
			pin := sha256.Sum256(leaf.RawSubjectPublicKeyInfo)
			if config.CertificateSHA256 != hex.EncodeToString(fingerprint[:]) || config.PublicKeyPin != "sha256//"+base64.StdEncoding.EncodeToString(pin[:]) {
				t.Fatal("bootstrap certificate identity mismatch")
			}
			other := x509.NewCertPool()
			if _, err := leaf.Verify(x509.VerifyOptions{Roots: other, DNSName: host}); err == nil {
				t.Fatal("bootstrap leaf trusted without the protected CA")
			}
		})
	}
}

func TestBootstrapRotatesAndRefusesOverwrite(t *testing.T) {
	parent := privateTestParent(t)
	var first connection
	var second connection
	for i, config := range []*connection{&first, &second} {
		name := filepath.Join(parent, []string{"first", "second"}[i])
		if err := run([]string{"-out-dir", name}, &bytes.Buffer{}); err != nil {
			t.Fatal(err)
		}
		before, err := os.ReadFile(filepath.Join(name, "connection.json"))
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(before, config); err != nil {
			t.Fatal(err)
		}
		if err := run([]string{"-out-dir", name}, &bytes.Buffer{}); err == nil {
			t.Fatal("bootstrap reused an existing directory")
		}
		after, err := os.ReadFile(filepath.Join(name, "connection.json"))
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("refused bootstrap modified existing credentials")
		}
	}
	if first.Token == second.Token || first.PublicKeyPin == second.PublicKeyPin || first.CACertificatePEM == second.CACertificatePEM {
		t.Fatal("bootstrap did not rotate independent launch credentials")
	}
}

func TestBootstrapRejectsUnsafePathsAndEndpoints(t *testing.T) {
	parent := privateTestParent(t)
	for _, args := range [][]string{
		{}, {"-out-dir", filepath.Join(parent, "bad"), "-host", "example.com"},
		{"-out-dir", filepath.Join(parent, "bad"), "-listen", "0.0.0.0:8765"},
		{"-out-dir", filepath.Join(parent, "bad"), "-listen", "127.0.0.1:0"},
		{"-out-dir", filepath.Join(parent, "bad"), "-listen", "127.0.0.1:65536"},
		{"-out-dir", filepath.Join(parent, "bad"), "-host", "::1", "-listen", "127.0.0.1:8765"},
	} {
		if err := run(args, &bytes.Buffer{}); err == nil {
			t.Fatalf("invalid bootstrap arguments accepted: %v", args)
		}
	}
	if _, err := os.Lstat(filepath.Join(parent, "bad")); !os.IsNotExist(err) {
		t.Fatal("invalid endpoint created output")
	}
	link := filepath.Join(parent, "link")
	if err := os.Symlink(parent, link); err != nil {
		t.Skipf("symlink fixture unavailable: %v", err)
	}
	if err := run([]string{"-out-dir", filepath.Join(link, "bad")}, &bytes.Buffer{}); err == nil {
		t.Fatal("bootstrap followed a parent symlink")
	}
	if err := run([]string{"-out-dir", link}, &bytes.Buffer{}); err == nil {
		t.Fatal("bootstrap followed an output symlink")
	}
}

func TestBootstrapNewFilesArePrivateBeforeWriting(t *testing.T) {
	directory, err := createBootstrapDirectory(filepath.Join(privateTestParent(t), "launch"))
	if err != nil {
		t.Fatal(err)
	}
	defer directory.Close()
	file, err := newPrivateFile(directory, "empty-secret")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() != 0 {
		t.Fatal("new private file was not empty")
	}
	if err := validateAccess(file, info, true); err != nil {
		t.Fatalf("new file was not private before secret writes: %v", err)
	}
}
