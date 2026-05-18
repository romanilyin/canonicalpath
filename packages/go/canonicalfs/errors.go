package canonicalfs

import "errors"

// ErrorCode is a stable machine-readable canonicalfs error code.
type ErrorCode string

const (
	// ErrAbsolutePath indicates that a root-relative path was absolute.
	ErrAbsolutePath ErrorCode = "ERR_ABSOLUTE_PATH"
	// ErrArchiveTraversal indicates a rejected archive entry path traversal.
	ErrArchiveTraversal ErrorCode = "ERR_ARCHIVE_TRAVERSAL"
	// ErrDriveRelativePath indicates a Windows drive-relative path such as C:foo.
	ErrDriveRelativePath ErrorCode = "ERR_DRIVE_RELATIVE_PATH"
	// ErrNULByte indicates that an input contains a NUL byte.
	ErrNULByte ErrorCode = "ERR_NUL_BYTE"
	// ErrOutsideRoot indicates that a path escaped the configured root.
	ErrOutsideRoot ErrorCode = "ERR_OUTSIDE_ROOT"
	// ErrRaceDetected indicates that a race attempt fixture was rejected.
	ErrRaceDetected ErrorCode = "ERR_RACE_DETECTED"
	// ErrReadLimitExceeded indicates that a file or request exceeded a configured read cap.
	ErrReadLimitExceeded ErrorCode = "ERR_READ_LIMIT_EXCEEDED"
	// ErrSymlinkEscape indicates that a symlink escaped the configured root.
	ErrSymlinkEscape ErrorCode = "ERR_SYMLINK_ESCAPE"
)

// ErrUnsupportedOperation indicates an operation unsupported by the active Go runtime.
var ErrUnsupportedOperation = errors.New("canonicalfs: operation is not supported by Go 1.24 os.Root")

// Error is a canonicalfs error with a stable code and human-readable message.
type Error struct {
	Code    ErrorCode
	Message string
}

// Error returns the formatted error string.
func (e *Error) Error() string {
	if e.Message == "" {
		return string(e.Code)
	}
	return string(e.Code) + ": " + e.Message
}

// Is reports whether target is a canonicalfs Error with the same code.
func (e *Error) Is(target error) bool {
	var other *Error
	if !errors.As(target, &other) {
		return false
	}
	return e.Code == other.Code
}

func newError(code ErrorCode, message string) error {
	return &Error{Code: code, Message: message}
}

// Code extracts a canonicalfs ErrorCode from err, or returns an empty code.
func Code(err error) ErrorCode {
	var fsErr *Error
	if errors.As(err, &fsErr) {
		return fsErr.Code
	}
	return ""
}
