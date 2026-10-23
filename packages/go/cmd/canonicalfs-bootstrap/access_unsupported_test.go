//go:build !unix && !windows

package main

import "testing"

func protectTestParent(t *testing.T, _ string) {
	t.Helper()
	t.Skip("private bootstrap access validation is unsupported on this platform")
}
