//go:build unix

package canonicalfs

import "syscall"

const regularOpenFlags = syscall.O_NONBLOCK
const regularFilesSupported = true
