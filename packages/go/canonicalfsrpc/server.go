// Package canonicalfsrpc exposes canonicalfs over a small JSON HTTP transport.
package canonicalfsrpc

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/romanilyin/canonicalpath/packages/go/canonicalfs"
	"github.com/romanilyin/canonicalpath/packages/go/canonicalpath"
)

const (
	// DefaultMaxRequestBytes is the default JSON request body cap for daemon endpoints.
	DefaultMaxRequestBytes int64 = 1 << 20
	// DefaultReadBytes is used when readFile omits max_bytes so reads are never unbounded.
	DefaultReadBytes int64 = 1 << 20
	// DefaultMaxReadBytes is the hard cap for readFile max_bytes.
	DefaultMaxReadBytes int64 = 16 << 20
	// DefaultMaxResponseBytes is the default encoded JSON response cap.
	DefaultMaxResponseBytes int64 = 24 << 20
)

// Server keeps root-bound project handles and serves canonicalfs operations.
type Server struct {
	mu               sync.Mutex
	roots            map[string]*canonicalfs.Root
	capabilityToken  string
	allowedRoots     []string
	maxRequestBytes  int64
	defaultReadBytes int64
	maxReadBytes     int64
	maxResponseBytes int64
}

// ServerOptions configures the canonicalfs JSON transport server.
type ServerOptions struct {
	CapabilityToken  string
	AllowedRoots     []string
	MaxRequestBytes  int64
	DefaultReadBytes int64
	MaxReadBytes     int64
	MaxResponseBytes int64
}

type serverLimits struct {
	maxRequestBytes  int64
	defaultReadBytes int64
	maxReadBytes     int64
	maxResponseBytes int64
}

type request struct {
	ProjectID  string `json:"project_id"`
	HostRoot   string `json:"host_root,omitempty"`
	Path       string `json:"path,omitempty"`
	Target     string `json:"target,omitempty"`
	Scope      string `json:"scope,omitempty"`
	Operation  string `json:"operation,omitempty"`
	DataBase64 string `json:"data_base64,omitempty"`
	MaxBytes   int64  `json:"max_bytes,omitempty"`
}

type response struct {
	DataBase64 string         `json:"data_base64,omitempty"`
	Stat       *statResponse  `json:"stat,omitempty"`
	Error      *errorResponse `json:"error,omitempty"`
}

type statResponse struct {
	Path        string `json:"path"`
	Size        int64  `json:"size"`
	IsDirectory bool   `json:"is_directory"`
}

type capsResponse struct {
	AuthRequired bool           `json:"auth_required"`
	Endpoints    []string       `json:"endpoints"`
	Limits       limitsResponse `json:"limits"`
}

type limitsResponse struct {
	MaxRequestBytes  int64 `json:"max_request_bytes"`
	DefaultReadBytes int64 `json:"default_read_bytes"`
	MaxReadBytes     int64 `json:"max_read_bytes"`
	MaxResponseBytes int64 `json:"max_response_bytes"`
}

type errorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// NewServer creates a canonicalfs JSON transport server.
func NewServer(options ServerOptions) (*Server, error) {
	capabilityToken := strings.TrimSpace(options.CapabilityToken)
	if capabilityToken == "" {
		return nil, errors.New("canonicalfsrpc: capability token is required")
	}
	allowedRoots, err := cleanAllowedRoots(options.AllowedRoots)
	if err != nil {
		return nil, err
	}
	limits, err := normalizeLimits(options)
	if err != nil {
		return nil, err
	}
	return &Server{
		roots:            make(map[string]*canonicalfs.Root),
		capabilityToken:  capabilityToken,
		allowedRoots:     allowedRoots,
		maxRequestBytes:  limits.maxRequestBytes,
		defaultReadBytes: limits.defaultReadBytes,
		maxReadBytes:     limits.maxReadBytes,
		maxResponseBytes: limits.maxResponseBytes,
	}, nil
}

// Handler returns an HTTP handler for the transport API.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/v1/caps", s.handleCaps)
	mux.HandleFunc("/v1/projects/open", s.handleOpenProject)
	mux.HandleFunc("/v1/projects/close", s.handleCloseProject)
	mux.HandleFunc("/v1/fs/readFile", s.handleReadFile)
	mux.HandleFunc("/v1/fs/writeFile", s.handleWriteFile)
	mux.HandleFunc("/v1/fs/stat", s.handleStat)
	mux.HandleFunc("/v1/fs/mkdirAll", s.handleMkdirAll)
	mux.HandleFunc("/v1/fs/remove", s.handleRemove)
	mux.HandleFunc("/v1/fs/rename", s.handleRename)
	mux.HandleFunc("/v1/scoped/readFile", s.handleScopedReadFile)
	mux.HandleFunc("/v1/scoped/writeFile", s.handleScopedWriteFile)
	mux.HandleFunc("/v1/scoped/stat", s.handleScopedStat)
	mux.HandleFunc("/v1/scoped/mkdirAll", s.handleScopedMkdirAll)
	mux.HandleFunc("/v1/scoped/remove", s.handleScopedRemove)
	mux.HandleFunc("/", s.handleNotFound)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" && !s.isAuthorized(r) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="canonicalfs"`)
			writeHTTPError(w, http.StatusUnauthorized, "ERR_UNAUTHORIZED", "missing or invalid bearer token")
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func (s *Server) isAuthorized(r *http.Request) bool {
	const prefix = "Bearer "
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	token := strings.TrimPrefix(header, prefix)
	return subtle.ConstantTimeCompare([]byte(token), []byte(s.capabilityToken)) == 1
}

// Close closes all project roots owned by the server.
func (s *Server) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var joined error
	for projectID, root := range s.roots {
		joined = errors.Join(joined, root.Close())
		delete(s.roots, projectID)
	}
	return joined
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeHTTPError(w, http.StatusMethodNotAllowed, "ERR_DAEMON", "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleCaps(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeHTTPError(w, http.StatusMethodNotAllowed, "ERR_DAEMON", "method not allowed")
		return
	}
	s.writeJSON(w, http.StatusOK, capsResponse{
		AuthRequired: true,
		Endpoints: []string{
			"GET /healthz",
			"GET /v1/caps",
			"POST /v1/projects/open",
			"POST /v1/projects/close",
			"POST /v1/fs/readFile",
			"POST /v1/fs/writeFile",
			"POST /v1/fs/stat",
			"POST /v1/fs/mkdirAll",
			"POST /v1/fs/remove",
			"POST /v1/fs/rename",
			"POST /v1/scoped/readFile",
			"POST /v1/scoped/writeFile",
			"POST /v1/scoped/stat",
			"POST /v1/scoped/mkdirAll",
			"POST /v1/scoped/remove",
		},
		Limits: limitsResponse{
			MaxRequestBytes:  s.maxRequestBytes,
			DefaultReadBytes: s.defaultReadBytes,
			MaxReadBytes:     s.maxReadBytes,
			MaxResponseBytes: s.maxResponseBytes,
		},
	})
}

func (s *Server) handleNotFound(w http.ResponseWriter, r *http.Request) {
	writeHTTPError(w, http.StatusNotFound, "ERR_DAEMON", "endpoint not found")
}

func (s *Server) handleOpenProject(w http.ResponseWriter, r *http.Request) {
	req, ok := s.decodeRequest(w, r)
	if !ok {
		return
	}
	if req.ProjectID == "" || req.HostRoot == "" {
		writeHTTPError(w, http.StatusBadRequest, string(canonicalfs.ErrOutsideRoot), "project_id and host_root are required")
		return
	}
	hostRoot, err := s.authorizeHostRoot(req.HostRoot)
	if err != nil {
		writeHTTPError(w, http.StatusForbidden, "ERR_ROOT_NOT_ALLOWED", err.Error())
		return
	}

	root, err := canonicalfs.OpenRoot(hostRoot)
	if err != nil {
		writeCanonicalError(w, err)
		return
	}

	s.mu.Lock()
	old := s.roots[req.ProjectID]
	s.roots[req.ProjectID] = root
	s.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}

	s.writeJSON(w, http.StatusOK, response{})
}

func (s *Server) handleCloseProject(w http.ResponseWriter, r *http.Request) {
	req, ok := s.decodeRequest(w, r)
	if !ok {
		return
	}
	root, err := s.takeRoot(req.ProjectID)
	if err != nil {
		writeCanonicalError(w, err)
		return
	}
	if err := root.Close(); err != nil {
		writeCanonicalError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, response{})
}

func (s *Server) handleReadFile(w http.ResponseWriter, r *http.Request) {
	req, root, ok := s.decodeRootRequest(w, r)
	if !ok {
		return
	}
	maxBytes, err := s.readLimit(req.MaxBytes)
	if err != nil {
		writeHTTPError(w, http.StatusBadRequest, string(canonicalfs.ErrReadLimitExceeded), err.Error())
		return
	}
	data, err := root.ReadFile(req.Path, maxBytes)
	if err != nil {
		writeCanonicalError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, response{DataBase64: base64.StdEncoding.EncodeToString(data)})
}

func (s *Server) handleWriteFile(w http.ResponseWriter, r *http.Request) {
	req, root, ok := s.decodeRootRequest(w, r)
	if !ok {
		return
	}
	data, err := base64.StdEncoding.DecodeString(req.DataBase64)
	if err != nil {
		writeHTTPError(w, http.StatusBadRequest, "ERR_DAEMON", "data_base64 is invalid")
		return
	}
	if err := root.WriteFile(req.Path, data, canonicalfs.OpenOptions{}); err != nil {
		writeCanonicalError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, response{})
}

func (s *Server) handleStat(w http.ResponseWriter, r *http.Request) {
	req, root, ok := s.decodeRootRequest(w, r)
	if !ok {
		return
	}
	info, err := root.Stat(req.Path)
	if err != nil {
		writeCanonicalError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, response{Stat: &statResponse{Path: req.Path, Size: info.Size(), IsDirectory: info.IsDir()}})
}

func (s *Server) handleMkdirAll(w http.ResponseWriter, r *http.Request) {
	req, root, ok := s.decodeRootRequest(w, r)
	if !ok {
		return
	}
	if err := root.MkdirAll(req.Path, 0o755); err != nil {
		writeCanonicalError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, response{})
}

func (s *Server) handleRemove(w http.ResponseWriter, r *http.Request) {
	req, root, ok := s.decodeRootRequest(w, r)
	if !ok {
		return
	}
	if err := root.Remove(req.Path); err != nil {
		writeCanonicalError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, response{})
}

func (s *Server) handleRename(w http.ResponseWriter, r *http.Request) {
	req, root, ok := s.decodeRootRequest(w, r)
	if !ok {
		return
	}
	if err := root.Rename(req.Path, req.Target); err != nil {
		writeCanonicalError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, response{})
}

func (s *Server) handleScopedReadFile(w http.ResponseWriter, r *http.Request) {
	req, root, rel, ok := s.decodeScopedRootRequest(w, r, "read")
	if !ok {
		return
	}
	maxBytes, err := s.readLimit(req.MaxBytes)
	if err != nil {
		writeHTTPError(w, http.StatusBadRequest, string(canonicalfs.ErrReadLimitExceeded), err.Error())
		return
	}
	data, err := root.ReadFile(rel, maxBytes)
	if err != nil {
		writeCanonicalError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, response{DataBase64: base64.StdEncoding.EncodeToString(data)})
}

func (s *Server) handleScopedWriteFile(w http.ResponseWriter, r *http.Request) {
	req, root, rel, ok := s.decodeScopedRootRequest(w, r, "write")
	if !ok {
		return
	}
	data, err := base64.StdEncoding.DecodeString(req.DataBase64)
	if err != nil {
		writeHTTPError(w, http.StatusBadRequest, "ERR_DAEMON", "data_base64 is invalid")
		return
	}
	if err := root.WriteFile(rel, data, canonicalfs.OpenOptions{}); err != nil {
		writeCanonicalError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, response{})
}

func (s *Server) handleScopedStat(w http.ResponseWriter, r *http.Request) {
	_, root, rel, ok := s.decodeScopedRootRequest(w, r, "read")
	if !ok {
		return
	}
	info, err := root.Stat(rel)
	if err != nil {
		writeCanonicalError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, response{Stat: &statResponse{Path: rel, Size: info.Size(), IsDirectory: info.IsDir()}})
}

func (s *Server) handleScopedMkdirAll(w http.ResponseWriter, r *http.Request) {
	_, root, rel, ok := s.decodeScopedRootRequest(w, r, "write")
	if !ok {
		return
	}
	if err := root.MkdirAll(rel, 0o755); err != nil {
		writeCanonicalError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, response{})
}

func (s *Server) handleScopedRemove(w http.ResponseWriter, r *http.Request) {
	_, root, rel, ok := s.decodeScopedRootRequest(w, r, "delete")
	if !ok {
		return
	}
	if err := root.Remove(rel); err != nil {
		writeCanonicalError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, response{})
}

func (s *Server) decodeRootRequest(w http.ResponseWriter, r *http.Request) (request, *canonicalfs.Root, bool) {
	req, ok := s.decodeRequest(w, r)
	if !ok {
		return request{}, nil, false
	}
	root, err := s.root(req.ProjectID)
	if err != nil {
		writeCanonicalError(w, err)
		return request{}, nil, false
	}
	return req, root, true
}

func (s *Server) decodeScopedRootRequest(w http.ResponseWriter, r *http.Request, requiredOperation string) (request, *canonicalfs.Root, string, bool) {
	req, root, ok := s.decodeRootRequest(w, r)
	if !ok {
		return request{}, nil, "", false
	}
	if req.Operation != "" && req.Operation != requiredOperation {
		writeHTTPError(w, http.StatusBadRequest, "ERR_UNSUPPORTED_OPERATION", "scoped operation does not match endpoint policy")
		return request{}, nil, "", false
	}
	result, err := canonicalpath.NormalizeUnityMCPScopedPath(canonicalpath.UnityMCPPathScope(req.Scope), req.Path)
	if err != nil {
		writeCanonicalPathError(w, err)
		return request{}, nil, "", false
	}
	if result.Kind != canonicalpath.ScopedPathKindProject {
		writeHTTPError(w, http.StatusBadRequest, "ERR_UNSUPPORTED_OPERATION", "scoped path is not backed by a project root")
		return request{}, nil, "", false
	}
	if !scopedOperationAllowed(result.Scope, requiredOperation) {
		writeHTTPError(w, http.StatusBadRequest, "ERR_UNSUPPORTED_OPERATION", "operation is not allowed for scoped path")
		return request{}, nil, "", false
	}
	return req, root, string(result.Path), true
}

func (s *Server) authorizeHostRoot(hostRoot string) (string, error) {
	clean, err := cleanHostRoot(hostRoot)
	if err != nil {
		return "", err
	}
	for _, allowed := range s.allowedRoots {
		inside, err := isInsideAllowedRoot(allowed, clean)
		if err != nil {
			continue
		}
		if inside {
			return clean, nil
		}
	}
	return "", fmt.Errorf("host_root is not in the daemon allowlist")
}

func (s *Server) readLimit(requested int64) (int64, error) {
	if requested < 0 {
		return 0, fmt.Errorf("max_bytes must be non-negative")
	}
	if requested == 0 {
		return s.defaultReadBytes, nil
	}
	if requested > s.maxReadBytes {
		return 0, fmt.Errorf("max_bytes exceeds server hard cap %d", s.maxReadBytes)
	}
	return requested, nil
}

func (s *Server) root(projectID string) (*canonicalfs.Root, error) {
	if projectID == "" {
		return nil, canonicalfs.ErrUnsupportedOperation
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root := s.roots[projectID]
	if root == nil {
		return nil, canonicalfs.ErrUnsupportedOperation
	}
	return root, nil
}

func (s *Server) takeRoot(projectID string) (*canonicalfs.Root, error) {
	if projectID == "" {
		return nil, canonicalfs.ErrUnsupportedOperation
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root := s.roots[projectID]
	if root == nil {
		return nil, canonicalfs.ErrUnsupportedOperation
	}
	delete(s.roots, projectID)
	return root, nil
}

func (s *Server) decodeRequest(w http.ResponseWriter, r *http.Request) (request, bool) {
	if r.Method != http.MethodPost {
		writeHTTPError(w, http.StatusMethodNotAllowed, "ERR_DAEMON", "method not allowed")
		return request{}, false
	}
	defer r.Body.Close()

	var req request
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, s.maxRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeHTTPError(w, http.StatusRequestEntityTooLarge, "ERR_REQUEST_TOO_LARGE", "request JSON exceeds server cap")
			return request{}, false
		}
		writeHTTPError(w, http.StatusBadRequest, "ERR_DAEMON", "request JSON is invalid")
		return request{}, false
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeHTTPError(w, http.StatusRequestEntityTooLarge, "ERR_REQUEST_TOO_LARGE", "request JSON exceeds server cap")
			return request{}, false
		}
		writeHTTPError(w, http.StatusBadRequest, "ERR_DAEMON", "request JSON has trailing data")
		return request{}, false
	}
	return req, true
}

func writeCanonicalError(w http.ResponseWriter, err error) {
	code := string(canonicalfs.Code(err))
	if code == "" {
		if errors.Is(err, canonicalfs.ErrUnsupportedOperation) {
			code = "ERR_UNSUPPORTED_OPERATION"
		} else {
			code = "ERR_DAEMON"
		}
	}
	writeHTTPError(w, http.StatusBadRequest, code, err.Error())
}

func writeCanonicalPathError(w http.ResponseWriter, err error) {
	code := string(canonicalpath.Code(err))
	if code == "" {
		code = "ERR_DAEMON"
	}
	writeHTTPError(w, http.StatusBadRequest, code, err.Error())
}

func scopedOperationAllowed(scope canonicalpath.UnityMCPPathScope, operation string) bool {
	switch scope {
	case canonicalpath.UnityMCPPathScopeUnityAsset:
		return operation == "read" || operation == "write"
	case canonicalpath.UnityMCPPathScopeKnowledge:
		return operation == "read" || operation == "write"
	case canonicalpath.UnityMCPPathScopePackageManifest:
		return operation == "read" || operation == "write"
	case canonicalpath.UnityMCPPathScopeArtifact:
		return operation == "read" || operation == "write"
	case canonicalpath.UnityMCPPathScopeTempSession:
		return operation == "read" || operation == "write" || operation == "delete"
	default:
		return false
	}
}

func writeHTTPError(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, response{Error: &errorResponse{Code: code, Message: message}})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, value any) {
	data, err := json.Marshal(value)
	if err != nil {
		writeHTTPError(w, http.StatusInternalServerError, "ERR_DAEMON", "response JSON encoding failed")
		return
	}
	if int64(len(data)) > s.maxResponseBytes {
		writeHTTPError(w, http.StatusRequestEntityTooLarge, "ERR_RESPONSE_TOO_LARGE", "response JSON exceeds server cap")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(data)
}

func cleanAllowedRoots(roots []string) ([]string, error) {
	allowed := make([]string, 0, len(roots))
	seen := make(map[string]bool, len(roots))
	for _, root := range roots {
		clean, err := cleanHostRoot(root)
		if err != nil {
			return nil, fmt.Errorf("canonicalfsrpc: allowed root %q is invalid: %w", root, err)
		}
		if seen[clean] {
			continue
		}
		seen[clean] = true
		allowed = append(allowed, clean)
	}
	if len(allowed) == 0 {
		return nil, errors.New("canonicalfsrpc: at least one allowed root is required")
	}
	return allowed, nil
}

func normalizeLimits(options ServerOptions) (serverLimits, error) {
	if options.MaxRequestBytes < 0 || options.DefaultReadBytes < 0 || options.MaxReadBytes < 0 || options.MaxResponseBytes < 0 {
		return serverLimits{}, errors.New("canonicalfsrpc: limit values must be non-negative")
	}
	limits := serverLimits{
		maxRequestBytes:  DefaultMaxRequestBytes,
		defaultReadBytes: DefaultReadBytes,
		maxReadBytes:     DefaultMaxReadBytes,
		maxResponseBytes: DefaultMaxResponseBytes,
	}
	if options.MaxRequestBytes > 0 {
		limits.maxRequestBytes = options.MaxRequestBytes
	}
	if options.DefaultReadBytes > 0 {
		limits.defaultReadBytes = options.DefaultReadBytes
	}
	if options.MaxReadBytes > 0 {
		limits.maxReadBytes = options.MaxReadBytes
	}
	if options.MaxResponseBytes > 0 {
		limits.maxResponseBytes = options.MaxResponseBytes
	}
	if limits.maxRequestBytes <= 0 {
		return serverLimits{}, errors.New("canonicalfsrpc: max request bytes must be positive")
	}
	if limits.defaultReadBytes <= 0 {
		return serverLimits{}, errors.New("canonicalfsrpc: default read bytes must be positive")
	}
	if limits.maxReadBytes < limits.defaultReadBytes {
		return serverLimits{}, errors.New("canonicalfsrpc: max read bytes must be greater than or equal to default read bytes")
	}
	if limits.maxResponseBytes <= 0 {
		return serverLimits{}, errors.New("canonicalfsrpc: max response bytes must be positive")
	}
	return limits, nil
}

func cleanHostRoot(root string) (string, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return "", errors.New("host root is empty")
	}
	if strings.ContainsRune(root, '\x00') {
		return "", errors.New("host root contains NUL")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(real)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("host root is not a directory")
	}
	return filepath.Clean(real), nil
}

func isInsideAllowedRoot(allowedRoot, hostRoot string) (bool, error) {
	rel, err := filepath.Rel(allowedRoot, hostRoot)
	if err != nil {
		return false, err
	}
	if rel == "." {
		return true, nil
	}
	if filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false, nil
	}
	return true, nil
}
