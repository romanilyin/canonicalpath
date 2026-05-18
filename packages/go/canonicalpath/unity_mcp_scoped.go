package canonicalpath

import "strings"

// UnityMCPPathScope identifies an explicit Unity MCP path scope.
type UnityMCPPathScope string

const (
	UnityMCPPathScopeUnityAsset      UnityMCPPathScope = "unity_asset"
	UnityMCPPathScopeKnowledge       UnityMCPPathScope = "knowledge"
	UnityMCPPathScopePackageManifest UnityMCPPathScope = "package_manifest"
	UnityMCPPathScopeArtifact        UnityMCPPathScope = "artifact"
	UnityMCPPathScopeGatewayCache    UnityMCPPathScope = "gateway_cache"
	UnityMCPPathScopeTempSession     UnityMCPPathScope = "temp_session"
)

// ScopedPathKind describes whether a scoped path is project-relative or cache-relative.
type ScopedPathKind string

const (
	ScopedPathKindProject ScopedPathKind = "project"
	ScopedPathKindCache   ScopedPathKind = "cache"
)

// ScopedPathResult is the lexical result of resolving a Unity MCP scoped path.
type ScopedPathResult struct {
	Scope UnityMCPPathScope
	Kind  ScopedPathKind
	Path  RelativePath
}

// NormalizeUnityMCPScopedPath validates and resolves a Unity MCP scoped path lexically.
func NormalizeUnityMCPScopedPath(scope UnityMCPPathScope, raw string) (ScopedPathResult, error) {
	clean, err := validateUnityMCPScopedRelativeInput(raw)
	if err != nil {
		return ScopedPathResult{}, err
	}

	switch scope {
	case UnityMCPPathScopeUnityAsset:
		return scopedProjectPath(scope, clean, startsWithAny(clean, "Assets", "Packages"))
	case UnityMCPPathScopePackageManifest:
		return packageManifestPath(scope, clean)
	case UnityMCPPathScopeKnowledge:
		return prefixedScopedProjectPath(scope, "Assets/UnityMcpKnowledge", clean, isPlainScopeRelative(clean))
	case UnityMCPPathScopeArtifact:
		return prefixedScopedProjectPath(scope, "Library/SGGUnityMcp", clean, startsWithAny(clean, "job-artifacts", "screenshots"))
	case UnityMCPPathScopeGatewayCache:
		if !startsWithAny(clean, "index") {
			return ScopedPathResult{}, newError(ErrOutsideRoot, "gateway cache path must be under index/")
		}
		return ScopedPathResult{Scope: scope, Kind: ScopedPathKindCache, Path: RelativePath(clean)}, nil
	case UnityMCPPathScopeTempSession:
		return prefixedScopedProjectPath(scope, "Temp/SGGUnityMcp", clean, isPlainScopeRelative(clean))
	default:
		return ScopedPathResult{}, newError(ErrInvalidPath, "unsupported Unity MCP path scope")
	}
}

func validateUnityMCPScopedRelativeInput(raw string) (string, error) {
	if raw == "" {
		return "", newError(ErrEmptyPath, "scoped path is empty")
	}
	if strings.ContainsRune(raw, '\x00') {
		return "", newError(ErrNULByte, "scoped path contains NUL")
	}
	if strings.HasPrefix(strings.ToLower(raw), "file://") {
		return "", newError(ErrUnsupportedURIScheme, "file URI is not allowed")
	}
	if hasEncodedScopedSeparator(raw) {
		return "", newError(ErrEncodedSeparator, "encoded path separators are not allowed")
	}
	if strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, `\\`) || hasDriveRoot(strings.ReplaceAll(raw, `\`, "/")) {
		return "", newError(ErrAbsolutePath, "scoped path must be relative")
	}
	if isDriveRelative(raw) {
		return "", newError(ErrDriveRelativePath, "drive-relative scoped paths are not allowed")
	}
	if strings.Contains(raw, `\`) {
		return "", newError(ErrInvalidPath, "scoped paths must use slash separators")
	}

	parts := strings.Split(raw, "/")
	for _, part := range parts {
		switch part {
		case "", ".":
			return "", newError(ErrInvalidPath, "scoped path contains an invalid component")
		case "..":
			return "", newError(ErrOutsideRoot, "scoped path traversal is not allowed")
		}
		if strings.Contains(part, ":") || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return "", newError(ErrInvalidPath, "scoped path contains an invalid component")
		}
		if len([]rune(part)) > 255 {
			return "", newError(ErrInvalidPath, "scoped path component exceeds length limit")
		}
	}
	if len([]rune(raw)) > 4096 {
		return "", newError(ErrInvalidPath, "scoped path exceeds length limit")
	}
	return raw, nil
}

func scopedProjectPath(scope UnityMCPPathScope, path string, allowed bool) (ScopedPathResult, error) {
	if !allowed {
		return ScopedPathResult{}, newError(ErrOutsideRoot, "scoped path is outside its allowed root")
	}
	return ScopedPathResult{Scope: scope, Kind: ScopedPathKindProject, Path: RelativePath(path)}, nil
}

func packageManifestPath(scope UnityMCPPathScope, path string) (ScopedPathResult, error) {
	if strings.HasPrefix(path, "Packages/manifest.json/") || strings.HasPrefix(path, "Packages/packages-lock.json/") {
		return ScopedPathResult{}, newError(ErrInvalidPath, "package manifest scope only accepts exact manifest files")
	}
	return scopedProjectPath(scope, path, path == "Packages/manifest.json" || path == "Packages/packages-lock.json")
}

func prefixedScopedProjectPath(scope UnityMCPPathScope, root string, path string, allowed bool) (ScopedPathResult, error) {
	if !allowed {
		return ScopedPathResult{}, newError(ErrOutsideRoot, "scoped path is outside its allowed root")
	}
	return ScopedPathResult{Scope: scope, Kind: ScopedPathKindProject, Path: RelativePath(root + "/" + path)}, nil
}

func isPlainScopeRelative(value string) bool {
	return !startsWithAny(value,
		"Assets",
		"AssetsEvil",
		"Packages",
		"PackagesEvil",
		"ProjectSettings",
		"Library",
		"Temp",
		"UnityMcpKnowledge",
		"UnityMcpKnowledgeEvil",
		"UnityMcpArtifacts",
		"UnityMcpGatewayCache",
		"UnityMcpTempSession",
	)
}

func startsWithAny(value string, roots ...string) bool {
	for _, root := range roots {
		if value == root || strings.HasPrefix(value, root+"/") {
			return true
		}
	}
	return false
}

func hasEncodedScopedSeparator(value string) bool {
	lower := strings.ToLower(value)
	return strings.Contains(lower, "%2f") || strings.Contains(lower, "%5c") || strings.Contains(lower, "%252f") || strings.Contains(lower, "%255c")
}
