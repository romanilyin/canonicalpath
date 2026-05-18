// Package canonicalpath provides deterministic lexical path identity helpers.
//
// Canonical paths are for identity, serialization, comparisons, RPC payloads,
// and cache/database keys. They are not a filesystem security boundary and do
// not inspect the real filesystem.
package canonicalpath
