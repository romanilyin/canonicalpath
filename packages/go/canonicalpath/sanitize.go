package canonicalpath

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"unicode/utf8"
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
	if !utf8.ValidString(raw) {
		return "", newError(ErrInvalidComponent, "git ref contains invalid Unicode")
	}
	slug := slugGitRef(raw)
	if len(slug) > 80 {
		slug = strings.Trim(slug[:80], "._-")
	}
	if slug == "" {
		slug = "ref"
	}
	hash := sha256.Sum256([]byte(raw))
	return "v2-" + slug + "--" + hex.EncodeToString(hash[:]), nil
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
