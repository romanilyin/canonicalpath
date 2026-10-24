//go:build !aix && !android && !darwin && !dragonfly && !freebsd && !illumos && !ios && !linux && !netbsd && !openbsd && !solaris && !windows

package canonicalfs

// js/wasm and plan9 use name-based os.Root implementations. Other targets,
// including wasip1, are outside the supported CanonicalFS backend contract.
const rootConfinementSupported = false
