package canonicalpath

import "errors"

// ErrorCode is a stable machine-readable canonicalpath error code.
type ErrorCode string

const (
	// ErrAbsolutePath indicates that a relative-only input was absolute.
	ErrAbsolutePath ErrorCode = "ERR_ABSOLUTE_PATH"
	// ErrAlternateDataStream indicates a rejected Windows alternate data stream.
	ErrAlternateDataStream ErrorCode = "ERR_ALTERNATE_DATA_STREAM"
	// ErrDriveRelativePath indicates a rejected Windows drive-relative path.
	ErrDriveRelativePath ErrorCode = "ERR_DRIVE_RELATIVE_PATH"
	// ErrEmptyPath indicates an empty path input.
	ErrEmptyPath ErrorCode = "ERR_EMPTY_PATH"
	// ErrEncodedSeparator indicates a rejected percent-encoded path separator.
	ErrEncodedSeparator ErrorCode = "ERR_ENCODED_SEPARATOR"
	// ErrInvalidComponent indicates an invalid path component input.
	ErrInvalidComponent ErrorCode = "ERR_INVALID_COMPONENT"
	// ErrInvalidPath indicates a syntactically invalid path.
	ErrInvalidPath ErrorCode = "ERR_INVALID_PATH"
	// ErrInvalidPercentEncoding indicates malformed percent encoding.
	ErrInvalidPercentEncoding ErrorCode = "ERR_INVALID_PERCENT_ENCODING"
	// ErrInvalidURI indicates a malformed URI input.
	ErrInvalidURI ErrorCode = "ERR_INVALID_URI"
	// ErrNULByte indicates that an input contains a NUL byte.
	ErrNULByte ErrorCode = "ERR_NUL_BYTE"
	// ErrOutsideRoot indicates that a relative operation escaped its root.
	ErrOutsideRoot ErrorCode = "ERR_OUTSIDE_ROOT"
	// ErrReservedDeviceName indicates a rejected Windows reserved device name.
	ErrReservedDeviceName ErrorCode = "ERR_RESERVED_DEVICE_NAME"
	// ErrUnsupportedURIScheme indicates a URI scheme that canonicalpath does not parse.
	ErrUnsupportedURIScheme ErrorCode = "ERR_UNSUPPORTED_URI_SCHEME"
)

// Error is a canonicalpath error with a stable code and human-readable message.
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

// Is reports whether target is a canonicalpath Error with the same code.
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

// Code extracts a canonicalpath ErrorCode from err, or returns an empty code.
func Code(err error) ErrorCode {
	var pathErr *Error
	if errors.As(err, &pathErr) {
		return pathErr.Code
	}
	return ""
}
