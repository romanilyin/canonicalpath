package canonicalpath

import (
	"net/url"
	"strings"
)

// ParseFileURI unwraps an allowed file-like URI into a path string.
func ParseFileURI(uri string, opts Options) (string, error) {
	if strings.ContainsRune(uri, '\x00') {
		return "", newError(ErrNULByte, "URI contains NUL")
	}

	switch {
	case strings.HasPrefix(uri, "file://"):
		if !opts.URI.AllowFileURI {
			return "", newError(ErrUnsupportedURIScheme, "file URI is not allowed")
		}
		return parseHierarchicalURIPath(uri, "file://", opts)
	case strings.HasPrefix(uri, "vscode-file://"):
		if !opts.URI.AllowVSCodeFileURI {
			return "", newError(ErrUnsupportedURIScheme, "vscode-file URI is not allowed")
		}
		return parseHierarchicalURIPath(uri, "vscode-file://", opts)
	case hasURIScheme(uri):
		return "", newError(ErrUnsupportedURIScheme, "unsupported URI scheme")
	default:
		return uri, nil
	}
}

func parseHierarchicalURIPath(raw string, prefix string, opts Options) (string, error) {
	if rejectEncodedSlash(opts) && hasEncodedSeparator(raw) {
		return "", newError(ErrEncodedSeparator, "URI contains an encoded path separator")
	}

	rest := strings.TrimPrefix(raw, prefix)
	slash := strings.Index(rest, "/")
	if slash < 0 {
		return "", newError(ErrInvalidURI, "URI path is empty")
	}
	authority := rest[:slash]
	pathPart := rest[slash:]
	decoded, err := url.PathUnescape(pathPart)
	if err != nil {
		return "", newError(ErrInvalidPercentEncoding, "URI percent encoding is invalid")
	}
	decodedAuthority, err := url.PathUnescape(authority)
	if err != nil {
		return "", newError(ErrInvalidPercentEncoding, "URI authority percent encoding is invalid")
	}
	if decoded == "" {
		return "", newError(ErrInvalidURI, "URI path is empty")
	}
	if prefix == "file://" && decodedAuthority != "" && !strings.EqualFold(decodedAuthority, "localhost") {
		return "//" + decodedAuthority + decoded, nil
	}
	return decoded, nil
}

func rejectEncodedSlash(opts Options) bool {
	return opts.URI.RejectEncodedSlash == nil || *opts.URI.RejectEncodedSlash
}

func hasEncodedSeparator(value string) bool {
	for i := 0; i+2 < len(value); i++ {
		if value[i] != '%' {
			continue
		}
		hi, okHi := fromHex(value[i+1])
		lo, okLo := fromHex(value[i+2])
		if !okHi || !okLo {
			continue
		}
		decoded := hi<<4 | lo
		if decoded == '/' || decoded == '\\' {
			return true
		}
	}
	return false
}

func fromHex(b byte) (byte, bool) {
	switch {
	case b >= '0' && b <= '9':
		return b - '0', true
	case b >= 'a' && b <= 'f':
		return b - 'a' + 10, true
	case b >= 'A' && b <= 'F':
		return b - 'A' + 10, true
	default:
		return 0, false
	}
}
