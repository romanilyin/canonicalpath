// Package canonicalfs provides root-bound filesystem operations.
//
// The Go implementation is the authoritative security layer for file access.
// It accepts project-relative paths and delegates real I/O to Go os.Root so
// path traversal and symlink escape checks are performed against a root handle.
//
// Supported GOOS values are aix, android, darwin, dragonfly, freebsd, illumos,
// ios, linux, netbsd, openbsd, solaris, and windows. OpenRoot and all Root methods
// return ErrUnsupportedOperation on every other target before filesystem access
// or caller callbacks. In particular, js/wasm and plan9 provide name-based roots
// that do not meet this package's confinement contract. WASI preview 1 (wasip1)
// is also unsupported until the complete CanonicalFS backend is validated there.
package canonicalfs
