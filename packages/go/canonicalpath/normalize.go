package canonicalpath

import (
	"strings"
	"unicode"
)

// Path is a canonical lexical path string.
type Path string

// RelativePath is a canonical relative path inside a root.
type RelativePath string

// HostKind describes the environment that produced an input path.
type HostKind string

const (
	// HostPOSIX identifies native POSIX-style input paths.
	HostPOSIX HostKind = "posix"
	// HostWin32 identifies native Windows input paths.
	HostWin32 HostKind = "win32"
	// HostWSL identifies WSL input paths that may map to Windows drives.
	HostWSL HostKind = "wsl"
	// HostVSCodeFileURI identifies file-like URI input from VS Code contexts.
	HostVSCodeFileURI HostKind = "vscode-file-uri"
	// HostDevContainer identifies development-container input contexts.
	HostDevContainer HostKind = "dev-container"
	// HostSSHRemote identifies SSH-remote input contexts.
	HostSSHRemote HostKind = "ssh-remote"

	// TargetPortable requests portable slash-separated canonical output.
	TargetPortable = "portable"
	// TargetWin32Drive requests lowercase-drive canonical Windows output.
	TargetWin32Drive = "win32-drive"
	// TargetPOSIX requests POSIX canonical output.
	TargetPOSIX = "posix"
)

// Options controls canonical path normalization.
type Options struct {
	SourceHost          HostKind       `json:"sourceHost"`
	TargetProfile       string         `json:"targetProfile"`
	WSL                 WSLOptions     `json:"wsl"`
	URI                 URIOptions     `json:"uri"`
	Windows             WindowsOptions `json:"windows"`
	TrimOuterWhitespace bool           `json:"trimOuterWhitespace"`
}

// URIOptions controls file URI parsing and percent-decoding behavior.
type URIOptions struct {
	AllowFileURI       bool  `json:"allowFileUri"`
	AllowVSCodeFileURI bool  `json:"allowVSCodeFileUri"`
	RejectEncodedSlash *bool `json:"rejectEncodedSlash"`
}

// WindowsOptions controls Windows-specific normalization and rejection rules.
type WindowsOptions struct {
	PreserveExtendedLength bool `json:"preserveExtendedLength"`
	RejectDeviceNames      bool `json:"rejectDeviceNames"`
	RejectADS              bool `json:"rejectADS"`
}

// DefaultOptions returns the zero-value normalization options.
func DefaultOptions() Options {
	return Options{}
}

// Normalize converts a raw path string into canonical lexical form.
func Normalize(raw string, opts Options) (Path, error) {
	if opts.TrimOuterWhitespace {
		raw = strings.TrimFunc(raw, unicode.IsSpace)
	}
	if raw == "" {
		return "", newError(ErrEmptyPath, "path is empty")
	}
	if strings.ContainsRune(raw, '\x00') {
		return "", newError(ErrNULByte, "path contains NUL")
	}

	value := raw
	if hasURIScheme(value) || opts.SourceHost == HostVSCodeFileURI {
		parsed, err := ParseFileURI(value, opts)
		if err != nil {
			return "", err
		}
		value = parsed
	}

	if !opts.Windows.PreserveExtendedLength {
		value = unwrapWindowsExtendedPrefix(value)
	}

	value = strings.ReplaceAll(value, "\\", "/")

	if shouldMapWSLDrive(opts) {
		if mapped, ok := mapWSLDrive(value, opts.WSL); ok {
			value = mapped
		}
	}

	if isURIWindowsDrivePath(value) {
		value = value[1:]
	}

	if isDriveRelative(value) {
		return "", newError(ErrDriveRelativePath, "Windows drive-relative paths are not canonical")
	}

	if hasDriveRoot(value) {
		value = strings.ToLower(value[:1]) + value[1:]
	}

	if opts.Windows.RejectADS && hasWindowsADS(value) {
		return "", newError(ErrAlternateDataStream, "Windows alternate data stream is not allowed")
	}
	if opts.Windows.RejectDeviceNames && hasReservedDeviceName(value) {
		return "", newError(ErrReservedDeviceName, "Windows reserved device name is not allowed")
	}

	cleaned, err := cleanCanonical(value)
	if err != nil {
		return "", err
	}
	if err := validateTargetProfile(cleaned, opts.TargetProfile); err != nil {
		return "", err
	}
	return Path(cleaned), nil
}

func shouldMapWSLDrive(opts Options) bool {
	return opts.TargetProfile != TargetPOSIX
}

func validateTargetProfile(value string, profile string) error {
	switch profile {
	case "", TargetPortable:
		return nil
	case TargetPOSIX:
		if hasDriveRoot(value) || strings.HasPrefix(value, "//") {
			return newError(ErrInvalidPath, "targetProfile posix does not allow Windows drive or UNC roots")
		}
		return nil
	case TargetWin32Drive:
		if strings.HasPrefix(value, "/") {
			return newError(ErrInvalidPath, "targetProfile win32-drive does not allow POSIX or UNC roots")
		}
		return nil
	default:
		return newError(ErrInvalidPath, "unsupported targetProfile")
	}
}

func hasURIScheme(value string) bool {
	idx := strings.Index(value, "://")
	if idx <= 0 {
		return false
	}
	for _, r := range value[:idx] {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '+' || r == '-' || r == '.') {
			return false
		}
	}
	return true
}

func cleanCanonical(value string) (string, error) {
	if value == "" {
		return "", newError(ErrEmptyPath, "path is empty")
	}

	prefix, rest, err := splitRoot(value)
	if err != nil {
		return "", err
	}

	parts := make([]string, 0)
	for _, part := range strings.Split(rest, "/") {
		switch part {
		case "", ".":
			continue
		case "..":
			if len(parts) > 0 {
				parts = parts[:len(parts)-1]
				continue
			}
			if prefix != "" {
				continue
			}
			return "", newError(ErrInvalidPath, "relative path escapes above its root")
		default:
			parts = append(parts, part)
		}
	}

	joined := strings.Join(parts, "/")
	if prefix == "" {
		if joined == "" {
			return ".", nil
		}
		return joined, nil
	}
	if prefix == "/" {
		if joined == "" {
			return "/", nil
		}
		return "/" + joined, nil
	}
	if strings.HasSuffix(prefix, "/") {
		if joined == "" {
			return prefix, nil
		}
		return prefix + joined, nil
	}
	if joined == "" {
		return prefix, nil
	}
	return prefix + "/" + joined, nil
}

func splitRoot(value string) (prefix string, rest string, err error) {
	if hasDriveRoot(value) {
		return value[:3], value[3:], nil
	}
	if strings.HasPrefix(value, "//") {
		parts := strings.Split(value[2:], "/")
		if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
			return "", "", newError(ErrInvalidPath, "UNC path requires server and share")
		}
		root := "//" + parts[0] + "/" + parts[1]
		return root, strings.Join(parts[2:], "/"), nil
	}
	if strings.HasPrefix(value, "/") {
		return "/", value[1:], nil
	}
	return "", value, nil
}

func hasDriveRoot(value string) bool {
	return len(value) >= 3 && isASCIILetter(value[0]) && value[1] == ':' && value[2] == '/'
}

func isDriveRelative(value string) bool {
	return len(value) >= 2 && isASCIILetter(value[0]) && value[1] == ':' && (len(value) == 2 || value[2] != '/')
}

func isURIWindowsDrivePath(value string) bool {
	return len(value) >= 4 && value[0] == '/' && isASCIILetter(value[1]) && value[2] == ':' && value[3] == '/'
}

func isASCIILetter(b byte) bool {
	return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z'
}
