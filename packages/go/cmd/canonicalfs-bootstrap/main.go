// canonicalfs-bootstrap creates private, per-launch daemon credentials.
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/big"
	"net"
	"os"
	"strconv"
	"time"
)

type connection struct {
	Version           int    `json:"version"`
	Endpoint          string `json:"endpoint"`
	Token             string `json:"token"`
	CACertificatePEM  string `json:"ca_certificate_pem"`
	CertificateSHA256 string `json:"certificate_sha256"`
	PublicKeyPin      string `json:"public_key_pin"`
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "canonicalfs-bootstrap:", err)
		os.Exit(1)
	}
}

func run(args []string, output io.Writer) error {
	flags := flag.NewFlagSet("canonicalfs-bootstrap", flag.ContinueOnError)
	flags.SetOutput(output)
	outDir := flags.String("out-dir", "", "new output directory inside an existing private, trusted parent")
	host := flags.String("host", "127.0.0.1", "certificate/endpoint host: localhost, 127.0.0.1 or ::1")
	listen := flags.String("listen", "127.0.0.1:8765", "loopback daemon listen address with an explicit nonzero port")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	endpoint, err := bootstrapEndpoint(*host, *listen)
	if err != nil {
		return err
	}
	if *outDir == "" {
		return errors.New("-out-dir is required")
	}
	directory, err := createBootstrapDirectory(*outDir)
	if err != nil {
		return err
	}
	defer directory.Close()
	files, err := credentialFiles(*host, endpoint, time.Now())
	if err != nil {
		return errors.New("cannot generate bootstrap credentials")
	}
	// connection.json is the completion marker. Never publish it before all
	// server credentials are written successfully. Partial private directories
	// remain on errors and must not be reused or recursively rolled back here.
	for _, name := range []string{"ca.pem", "certificate.pem", "key.pem", "token", "connection.json"} {
		if err := writePrivateFile(directory, name, files[name]); err != nil {
			return fmt.Errorf("cannot write private %s; bootstrap is incomplete: %w", name, err)
		}
	}
	_, err = fmt.Fprintf(output, "Created private daemon bootstrap in %s\n", *outDir)
	return err
}

func bootstrapEndpoint(host, listen string) (string, error) {
	if host != "localhost" && host != "127.0.0.1" && host != "::1" {
		return "", errors.New("-host must be localhost, 127.0.0.1 or ::1")
	}
	address, portText, err := net.SplitHostPort(listen)
	if err != nil {
		return "", errors.New("-listen must be a loopback address with a port")
	}
	ip := net.ParseIP(address)
	port, portErr := strconv.Atoi(portText)
	if ip == nil || !ip.IsLoopback() || portErr != nil || port < 1 || port > 65535 {
		return "", errors.New("-listen must be a loopback IP with a port between 1 and 65535")
	}
	if hostIP := net.ParseIP(host); hostIP != nil && !hostIP.Equal(ip) {
		return "", errors.New("IP -host must match the -listen address")
	}
	return "https://" + net.JoinHostPort(host, strconv.Itoa(port)), nil
}

func credentialFiles(host, endpoint string, now time.Time) (map[string][]byte, error) {
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	serverKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	serial := func() (*big.Int, error) {
		value, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
		if err == nil {
			value.Add(value, big.NewInt(1))
		}
		return value, err
	}
	caSerial, err := serial()
	if err != nil {
		return nil, err
	}
	leafSerial, err := serial()
	if err != nil {
		return nil, err
	}
	ca := &x509.Certificate{
		SerialNumber: caSerial, Subject: pkix.Name{CommonName: "CanonicalFS per-launch CA"},
		NotBefore: now.Add(-5 * time.Minute), NotAfter: now.Add(24 * time.Hour),
		IsCA: true, BasicConstraintsValid: true, MaxPathLenZero: true,
		KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	if err != nil {
		return nil, err
	}
	leaf := &x509.Certificate{
		SerialNumber: leafSerial, Subject: pkix.Name{CommonName: "CanonicalFS per-launch daemon"},
		NotBefore: ca.NotBefore, NotAfter: ca.NotAfter, BasicConstraintsValid: true,
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	if ip := net.ParseIP(host); ip != nil {
		leaf.IPAddresses = []net.IP{ip}
	} else {
		leaf.DNSNames = []string{host}
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leaf, ca, &serverKey.PublicKey, caKey)
	if err != nil {
		return nil, err
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(serverKey)
	if err != nil {
		return nil, err
	}
	spki, err := x509.MarshalPKIXPublicKey(&serverKey.PublicKey)
	if err != nil {
		return nil, err
	}
	var tokenBytes [32]byte
	if _, err := rand.Read(tokenBytes[:]); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(tokenBytes[:])
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})
	leafPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER})
	fingerprint := sha256.Sum256(leafDER)
	pin := sha256.Sum256(spki)
	config, err := json.MarshalIndent(connection{
		Version: 1, Endpoint: endpoint, Token: token, CACertificatePEM: string(caPEM),
		CertificateSHA256: hex.EncodeToString(fingerprint[:]),
		PublicKeyPin:      "sha256//" + base64.StdEncoding.EncodeToString(pin[:]),
	}, "", "  ")
	if err != nil {
		return nil, err
	}
	return map[string][]byte{
		"ca.pem": caPEM, "certificate.pem": append(leafPEM, caPEM...),
		"key.pem":         pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}),
		"token":           []byte(token + "\n"),
		"connection.json": append(config, '\n'),
	}, nil
}
