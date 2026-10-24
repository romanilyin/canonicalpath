package canonicalfsrpc

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"sync"
	"time"
)

const (
	DefaultMaxConnections                = 256
	DefaultMaxUnauthenticatedConnections = 32
	DefaultAuthenticationTimeout         = 5 * time.Second
	DefaultMaxHeaderBytes                = 16 << 10
)

// ConnectionLimits bounds accepted sockets, including those waiting for TLS or
// their first valid bearer. The pending limit leaves room for connections that
// have already authenticated; it cannot identify a newly arriving client before
// that client's TLS handshake and HTTP headers have been read.
type ConnectionLimits struct {
	MaxConnections                int
	MaxUnauthenticatedConnections int
	AuthenticationTimeout         time.Duration
}

func (limits ConnectionLimits) Validate() error {
	if limits.MaxConnections <= 0 || limits.MaxUnauthenticatedConnections <= 0 || limits.AuthenticationTimeout <= 0 {
		return errors.New("canonicalfsrpc: connection limits and authentication timeout must be positive")
	}
	if limits.MaxUnauthenticatedConnections >= limits.MaxConnections {
		return errors.New("canonicalfsrpc: unauthenticated connection limit must be smaller than total connection limit")
	}
	return nil
}

// BoundedListener limits sockets before a TLS listener creates handshake work.
// Use it beneath http.Server.ServeTLS and install its ConnContext callback on
// that HTTP server. Server.Handler then promotes a connection only after valid
// bearer authentication. Handler alone does not impose socket admission limits.
type BoundedListener struct {
	net.Listener
	limits  ConnectionLimits
	mu      sync.Mutex
	active  map[*admittedConnection]struct{}
	pending int
}

func NewBoundedListener(listener net.Listener, limits ConnectionLimits) (*BoundedListener, error) {
	if listener == nil {
		return nil, errors.New("canonicalfsrpc: connection admission requires a listener")
	}
	if err := limits.Validate(); err != nil {
		return nil, err
	}
	return &BoundedListener{Listener: listener, limits: limits, active: make(map[*admittedConnection]struct{})}, nil
}

func (listener *BoundedListener) Accept() (net.Conn, error) {
	for {
		connection, err := listener.Listener.Accept()
		if err != nil {
			return nil, err
		}
		acceptedAt := time.Now()
		listener.mu.Lock()
		if len(listener.active) >= listener.limits.MaxConnections || listener.pending >= listener.limits.MaxUnauthenticatedConnections {
			listener.mu.Unlock()
			// At most this single transient rejected socket exists outside the
			// admitted set. No HTTP/TLS goroutine or timer is created for it.
			_ = connection.Close()
			continue
		}
		admitted := &admittedConnection{Conn: connection, listener: listener, deadline: acceptedAt.Add(listener.limits.AuthenticationTimeout)}
		listener.active[admitted] = struct{}{}
		listener.pending++
		admitted.expiry = time.AfterFunc(time.Until(admitted.deadline), admitted.expire)
		listener.mu.Unlock()
		return admitted, nil
	}
}

type admittedConnectionKey struct{}

// ConnContext associates the underlying accepted socket with HTTP requests. TLS
// wrapping is removed only for this lookup; plaintext is never substituted for
// the TLS connection served by net/http.
func (listener *BoundedListener) ConnContext(ctx context.Context, connection net.Conn) context.Context {
	if encrypted, ok := connection.(*tls.Conn); ok {
		connection = encrypted.NetConn()
	}
	if admitted, ok := connection.(*admittedConnection); ok && admitted.listener == listener {
		return context.WithValue(ctx, admittedConnectionKey{}, admitted)
	}
	return ctx
}

func authenticateConnection(ctx context.Context) bool {
	connection, ok := ctx.Value(admittedConnectionKey{}).(*admittedConnection)
	if !ok {
		return true // An embedded Handler may use a caller-owned transport.
	}
	listener := connection.listener
	listener.mu.Lock()
	if _, present := listener.active[connection]; !present || connection.expired {
		listener.mu.Unlock()
		return false
	}
	if connection.authenticated {
		listener.mu.Unlock()
		return true
	}
	if !time.Now().Before(connection.deadline) {
		connection.expired = true
		listener.mu.Unlock()
		_ = connection.Close()
		return false
	}
	connection.authenticated = true
	listener.pending--
	connection.expiry.Stop()
	listener.mu.Unlock()
	return true
}

type admittedConnection struct {
	net.Conn
	listener      *BoundedListener
	expiry        *time.Timer
	deadline      time.Time
	authenticated bool // guarded by listener.mu
	expired       bool // guarded by listener.mu
	closeOnce     sync.Once
	closeError    error
}

func (connection *admittedConnection) expire() {
	listener := connection.listener
	listener.mu.Lock()
	_, present := listener.active[connection]
	shouldClose := present && !connection.authenticated && !connection.expired
	if shouldClose {
		connection.expired = true
	}
	listener.mu.Unlock()
	// Stop cannot retract a callback that has already started. Promotion and
	// expiration therefore make their state decision under the same lock; a
	// delayed callback must never close a socket that already authenticated.
	if shouldClose {
		_ = connection.Close()
	}
}

func (connection *admittedConnection) Close() error {
	connection.closeOnce.Do(func() {
		connection.closeError = connection.Conn.Close()
		listener := connection.listener
		listener.mu.Lock()
		defer listener.mu.Unlock()
		connection.expiry.Stop()
		if _, present := listener.active[connection]; present {
			delete(listener.active, connection)
			if !connection.authenticated {
				listener.pending--
			}
		}
	})
	return connection.closeError
}
