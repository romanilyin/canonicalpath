package main

import (
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/romanilyin/canonicalpath/packages/go/canonicalfsrpc"
)

type stringListFlag []string

func (f *stringListFlag) String() string {
	return strings.Join(*f, string(os.PathListSeparator))
}

func (f *stringListFlag) Set(value string) error {
	value = strings.TrimSpace(value)
	if value != "" {
		*f = append(*f, value)
	}
	return nil
}

func main() {
	listen := flag.String("listen", "127.0.0.1:8765", "HTTPS listen address")
	tokenFile := flag.String("token-file", "", "private file containing the bearer token; alternatively use CANONICALFS_DAEMON_TOKEN")
	tlsCert := flag.String("tls-cert", "", "TLS certificate file; required for every listener, including loopback")
	tlsKey := flag.String("tls-key", "", "TLS private key file")
	maxProjects := flag.Int("max-projects", 128, "maximum retained project roots")
	projectIdleTimeout := flag.Duration("project-idle-timeout", 30*time.Minute, "idle registration lease duration")
	maxRequestBytes := flag.Int64("max-request-bytes", canonicalfsrpc.DefaultMaxRequestBytes, "maximum JSON request body bytes")
	defaultReadBytes := flag.Int64("default-read-bytes", canonicalfsrpc.DefaultReadBytes, "default readFile max bytes when max_bytes is omitted")
	maxReadBytes := flag.Int64("max-read-bytes", canonicalfsrpc.DefaultMaxReadBytes, "hard cap for readFile max_bytes")
	maxResponseBytes := flag.Int64("max-response-bytes", canonicalfsrpc.DefaultMaxResponseBytes, "maximum encoded JSON response bytes")
	maxConnections := flag.Int("max-connections", canonicalfsrpc.DefaultMaxConnections, "maximum admitted TCP connections, including TLS handshakes")
	maxUnauthenticatedConnections := flag.Int("max-unauthenticated-connections", canonicalfsrpc.DefaultMaxUnauthenticatedConnections, "maximum connections awaiting a valid bearer; must be less than -max-connections")
	authenticationTimeout := flag.Duration("authentication-timeout", canonicalfsrpc.DefaultAuthenticationTimeout, "absolute deadline from TCP acceptance to the first valid bearer")
	maxHeaderBytes := flag.Int("max-header-bytes", canonicalfsrpc.DefaultMaxHeaderBytes, "maximum HTTP request header bytes")
	readHeaderTimeout := flag.Duration("read-header-timeout", 5*time.Second, "HTTP server read header timeout")
	readTimeout := flag.Duration("read-timeout", 30*time.Second, "HTTP server read timeout")
	writeTimeout := flag.Duration("write-timeout", 30*time.Second, "HTTP server write timeout")
	idleTimeout := flag.Duration("idle-timeout", 120*time.Second, "HTTP server idle timeout")
	var allowRoots stringListFlag
	flag.Var(&allowRoots, "allow-root", "trusted host root or parent directory allowed for project registration; repeatable; can also be set with CANONICALFS_ALLOWED_ROOTS")
	flag.Parse()

	if err := validateListener(*listen, *tlsCert, *tlsKey); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	connectionLimits := canonicalfsrpc.ConnectionLimits{
		MaxConnections:                *maxConnections,
		MaxUnauthenticatedConnections: *maxUnauthenticatedConnections,
		AuthenticationTimeout:         *authenticationTimeout,
	}
	if err := connectionLimits.Validate(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	if *maxHeaderBytes <= 0 {
		fmt.Fprintln(os.Stderr, "-max-header-bytes must be positive")
		os.Exit(2)
	}
	token, err := readToken(*tokenFile)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	_ = os.Unsetenv("CANONICALFS_DAEMON_TOKEN")
	roots := append([]string(nil), allowRoots...)
	if envRoots := os.Getenv("CANONICALFS_ALLOWED_ROOTS"); envRoots != "" {
		roots = append(roots, filepathList(envRoots)...)
	}
	if len(roots) == 0 {
		fmt.Fprintln(os.Stderr, "canonicalfs daemon requires at least one -allow-root or CANONICALFS_ALLOWED_ROOTS entry")
		os.Exit(2)
	}

	daemon, err := canonicalfsrpc.NewServer(canonicalfsrpc.ServerOptions{
		CapabilityToken:    token,
		MaxProjects:        *maxProjects,
		ProjectIdleTimeout: *projectIdleTimeout,
		AllowedRoots:       roots,
		MaxRequestBytes:    *maxRequestBytes,
		DefaultReadBytes:   *defaultReadBytes,
		MaxReadBytes:       *maxReadBytes,
		MaxResponseBytes:   *maxResponseBytes,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	defer daemon.Close()

	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	server := &http.Server{
		TLSConfig:         &tls.Config{MinVersion: tls.VersionTLS12},
		Protocols:         protocols,
		Addr:              *listen,
		Handler:           daemon.Handler(),
		ReadHeaderTimeout: *readHeaderTimeout,
		ReadTimeout:       *readTimeout,
		WriteTimeout:      *writeTimeout,
		IdleTimeout:       *idleTimeout,
		MaxHeaderBytes:    *maxHeaderBytes,
	}
	rawListener, err := net.Listen("tcp", *listen)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	listener, err := canonicalfsrpc.NewBoundedListener(rawListener, connectionLimits)
	if err != nil {
		_ = rawListener.Close()
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	defer listener.Close()
	server.ConnContext = listener.ConnContext
	fmt.Fprintf(os.Stderr, "canonicalfs daemon listening on https://%s\n", listener.Addr())
	err = server.ServeTLS(listener, *tlsCert, *tlsKey)
	if err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func filepathList(value string) []string {
	parts := strings.Split(value, string(os.PathListSeparator))
	roots := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			roots = append(roots, part)
		}
	}
	return roots
}

func validateListener(address, cert, key string) error {
	if (cert == "") != (key == "") {
		return errors.New("both -tls-cert and -tls-key are required")
	}
	_, _, err := net.SplitHostPort(address)
	if err != nil {
		return errors.New("invalid listen address")
	}
	if cert == "" {
		return errors.New("every listener requires -tls-cert and -tls-key; plaintext loopback does not authenticate the daemon")
	}
	return nil
}

func readToken(file string) (string, error) {
	token := os.Getenv("CANONICALFS_DAEMON_TOKEN")
	if file != "" {
		handle, err := os.Open(file)
		if err != nil {
			return "", errors.New("cannot open token file")
		}
		defer handle.Close()
		info, err := handle.Stat()
		if err != nil || !info.Mode().IsRegular() || info.Size() > 4096 {
			return "", errors.New("token file must be a small regular file")
		}
		if err := validateTokenFileAccess(handle, info); err != nil {
			return "", err
		}
		data := make([]byte, info.Size())
		if _, err := handle.ReadAt(data, 0); err != nil {
			return "", errors.New("cannot read token file")
		}
		token = string(data)
	}
	token = strings.TrimSpace(token)
	if err := canonicalfsrpc.ValidateCapabilityToken(token); err != nil {
		return "", err
	}
	return token, nil
}
