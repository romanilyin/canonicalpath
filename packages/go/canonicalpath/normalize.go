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
	// HostCanonical identifies canonical grammar without raw host inference.
	HostCanonical HostKind = "canonical"
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
	mountRoot, err := normalizeMountRoot(opts.WSL.MountRoot)
	if err != nil {
		return "", err
	}
	opts.WSL.MountRoot = mountRoot
	if opts.SourceHost == HostPOSIX && opts.WSL.Enabled {
		return "", newError(ErrInvalidPath, "native POSIX input cannot request WSL drive mapping")
	}

	value := raw
	if opts.SourceHost == HostPOSIX {
		value, err = prepareNativePOSIX(value)
	} else if opts.SourceHost != HostCanonical {
		value, err = normalizeRawInput(value, opts)
	}
	if err != nil {
		return "", err
	}
	if _, _, err := splitRoot(value); err != nil {
		return "", err
	}
	if err := validateWindowsComponents(value, opts.Windows); err != nil {
		return "", err
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

func normalizeRawInput(value string, opts Options) (string, error) {
	uriInput := hasURIScheme(value)
	if uriInput || opts.SourceHost == HostVSCodeFileURI {
		parsed, err := ParseFileURI(value, opts)
		if err != nil {
			return "", err
		}
		value = parsed
	}
	// An enabled WSL candidate uses POSIX separators before raw Windows
	// rewriting. Literal backslashes can belong to its mount or unmapped path.
	if opts.WSL.Enabled && strings.HasPrefix(value, "/") &&
		(!strings.HasPrefix(value, "//") || strings.HasPrefix(value, "///")) &&
		!(uriInput && isURIWindowsDrivePath(value)) {
		prepared, err := prepareNativePOSIX(value)
		if err != nil {
			return "", err
		}
		if err := validateWindowsComponents(prepared, opts.Windows); err != nil {
			return "", err
		}
		cleaned, err := cleanCanonical(prepared)
		if err != nil {
			return "", err
		}
		if opts.TargetProfile != TargetPOSIX {
			if mapped, ok := mapWSLDrive(cleaned, opts.WSL); ok {
				return mapped, nil
			}
		}
		return cleaned, nil
	}
	value = strings.ReplaceAll(value, "\\", "/")
	if strings.HasPrefix(value, "//?/") {
		if _, _, err := splitRoot(value); err != nil {
			return "", err
		}
	}
	if !opts.Windows.PreserveExtendedLength {
		value = unwrapWindowsExtendedPrefix(value)
	}
	if isURIWindowsDrivePath(value) {
		value = value[1:]
	}
	return value, nil
}

func validateWindowsComponents(value string, opts WindowsOptions) error {
	if opts.RejectADS && hasWindowsADS(value) {
		return newError(ErrAlternateDataStream, "Windows alternate data stream is not allowed")
	}
	if opts.RejectDeviceNames && hasReservedDeviceName(value) {
		return newError(ErrReservedDeviceName, "Windows reserved device name is not allowed")
	}
	return nil
}

func validateTargetProfile(value string, profile string) error {
	prefix, _, err := splitRoot(value)
	if err != nil {
		return err
	}
	switch profile {
	case "", TargetPortable:
		return nil
	case TargetPOSIX:
		if isWindowsRoot(prefix) {
			return newError(ErrInvalidPath, "targetProfile posix does not allow Windows roots")
		}
		return nil
	case TargetWin32Drive:
		if prefix == "/" || (isWindowsRoot(prefix) && !isDriveRoot(prefix)) {
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
