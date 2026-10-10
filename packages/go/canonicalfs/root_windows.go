//go:build windows

package canonicalfs

// os.Root rejects Windows device names and escaping reparse points.
const regularOpenFlags = 0
const regularFilesSupported = true
