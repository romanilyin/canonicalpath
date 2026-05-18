// Package canonicalfs provides root-bound filesystem operations.
//
// The Go implementation is the authoritative security layer for file access.
// It accepts project-relative paths and delegates real I/O to Go os.Root so
// path traversal and symlink escape checks are performed against a root handle.
package canonicalfs
