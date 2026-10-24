//go:build aix || android || darwin || dragonfly || freebsd || illumos || ios || linux || netbsd || openbsd || solaris || windows

package canonicalfs

// Keep this allowlist explicit: a new Go target must be reviewed before its
// os.Root and regular-file implementations become part of our security boundary.
const rootConfinementSupported = true
