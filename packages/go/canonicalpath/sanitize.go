package canonicalpath

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// SanitizeComponent converts a user string into a filesystem-friendly component.
func SanitizeComponent(name string, profile string) (string, error) {
	if name == "" {
		return "", newError(ErrInvalidComponent, "component is empty")
	}
	if strings.ContainsRune(name, '\x00') {
		return "", newError(ErrNULByte, "component contains NUL")
	}
	replacer := strings.NewReplacer("/", "-", "\\", "-", ":", "-", "\t", "-", "\n", "-", "\r", "-")
	value := strings.Trim(replacer.Replace(name), " ._-")
	if value == "" {
		value = "component"
	}
	if profile == "win32" {
		value = escapeReservedWin32Component(value)
	}
	return value, nil
}

// EncodeComponent encodes a user string as a component for the selected profile.
func EncodeComponent(name string, profile string) (string, error) {
	return SanitizeComponent(name, profile)
}

// EncodeGitRef encodes a Git ref into a collision-resistant directory name.
func EncodeGitRef(raw string) (string, error) {
	if raw == "" {
		return "", newError(ErrInvalidComponent, "git ref is empty")
	}
	if strings.ContainsRune(raw, '\x00') {
		return "", newError(ErrNULByte, "git ref contains NUL")
	}
	slug := slugGitRef(raw)
	hash := sha256.Sum256([]byte(raw))
	return slug + "--" + hex.EncodeToString(hash[:])[:12], nil
}

func slugGitRef(raw string) string {
	var builder strings.Builder
	lastDash := false
	for _, r := range raw {
		allowed := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-'
		if allowed {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	slug := strings.Trim(builder.String(), "._-")
	if slug == "" {
		return "ref"
	}
	return slug
}

func escapeReservedWin32Component(value string) string {
	base := value
	suffix := ""
	if idx := strings.Index(base, "."); idx >= 0 {
		base = value[:idx]
		suffix = value[idx:]
	}
	if isReservedDeviceBase(strings.ToUpper(base)) {
		return base + "-" + suffix
	}
	return value
}
