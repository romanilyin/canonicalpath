package main

import (
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"runtime"
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
	listen := flag.String("listen", "127.0.0.1:8765", "HTTP listen address")
	tokenFile := flag.String("token-file", "", "private file containing the bearer token; alternatively use CANONICALFS_DAEMON_TOKEN")
	tlsCert := flag.String("tls-cert", "", "TLS certificate file; required for non-loopback listeners")
	tlsKey := flag.String("tls-key", "", "TLS private key file")
	maxProjects := flag.Int("max-projects", 128, "maximum retained project roots")
	projectIdleTimeout := flag.Duration("project-idle-timeout", 30*time.Minute, "idle registration lease duration")
	maxRequestBytes := flag.Int64("max-request-bytes", canonicalfsrpc.DefaultMaxRequestBytes, "maximum JSON request body bytes")
	defaultReadBytes := flag.Int64("default-read-bytes", canonicalfsrpc.DefaultReadBytes, "default readFile max bytes when max_bytes is omitted")
	maxReadBytes := flag.Int64("max-read-bytes", canonicalfsrpc.DefaultMaxReadBytes, "hard cap for readFile max_bytes")
	maxResponseBytes := flag.Int64("max-response-bytes", canonicalfsrpc.DefaultMaxResponseBytes, "maximum encoded JSON response bytes")
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

	server := &http.Server{
		Addr:              *listen,
		Handler:           daemon.Handler(),
		ReadHeaderTimeout: *readHeaderTimeout,
		ReadTimeout:       *readTimeout,
		WriteTimeout:      *writeTimeout,
		IdleTimeout:       *idleTimeout,
	}
	scheme := "http"
	if *tlsCert != "" {
		scheme = "https"
	}
	fmt.Fprintf(os.Stderr, "canonicalfs daemon listening on %s://%s\n", scheme, *listen)
	if *tlsCert != "" {
		err = server.ListenAndServeTLS(*tlsCert, *tlsKey)
	} else {
		err = server.ListenAndServe()
	}
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
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return errors.New("invalid listen address")
	}
	ip := net.ParseIP(host)
	if cert == "" && host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return errors.New("non-loopback listeners require TLS")
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
		if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
			return "", errors.New("token file must only be accessible to its owner")
		}
		data := make([]byte, info.Size())
		if _, err := handle.ReadAt(data, 0); err != nil {
			return "", errors.New("cannot read token file")
		}
		token = string(data)
	}
	token = strings.TrimSpace(token)
	if len(token) < 32 || strings.ContainsAny(token, "\r\n") {
		return "", errors.New("provide a randomly generated bearer token of at least 32 characters through -token-file or CANONICALFS_DAEMON_TOKEN")
	}
	return token, nil
}
