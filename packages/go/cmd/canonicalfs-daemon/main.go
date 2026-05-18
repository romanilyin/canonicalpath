package main

import (
	"flag"
	"fmt"
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
	listen := flag.String("listen", "127.0.0.1:8765", "HTTP listen address")
	tokenFlag := flag.String("token", "", "bearer capability token; can also be set with CANONICALFS_DAEMON_TOKEN")
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

	token := *tokenFlag
	if token == "" {
		token = os.Getenv("CANONICALFS_DAEMON_TOKEN")
	}
	if token == "" {
		fmt.Fprintln(os.Stderr, "canonicalfs daemon requires -token or CANONICALFS_DAEMON_TOKEN")
		os.Exit(2)
	}
	roots := append([]string(nil), allowRoots...)
	if envRoots := os.Getenv("CANONICALFS_ALLOWED_ROOTS"); envRoots != "" {
		roots = append(roots, filepathList(envRoots)...)
	}
	if len(roots) == 0 {
		fmt.Fprintln(os.Stderr, "canonicalfs daemon requires at least one -allow-root or CANONICALFS_ALLOWED_ROOTS entry")
		os.Exit(2)
	}

	daemon, err := canonicalfsrpc.NewServer(canonicalfsrpc.ServerOptions{
		CapabilityToken:  token,
		AllowedRoots:     roots,
		MaxRequestBytes:  *maxRequestBytes,
		DefaultReadBytes: *defaultReadBytes,
		MaxReadBytes:     *maxReadBytes,
		MaxResponseBytes: *maxResponseBytes,
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
	fmt.Fprintf(os.Stderr, "canonicalfs daemon listening on http://%s\n", *listen)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
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
