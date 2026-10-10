//go:build !windows

package main

import "testing"

func protectTestTokenFile(t *testing.T, file string) { t.Helper() }
