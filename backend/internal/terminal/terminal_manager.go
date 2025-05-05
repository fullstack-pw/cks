// backend/internal/terminal/terminal_manager.go - Terminal session management

package terminal

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/remotecommand"
)

// Manager handles terminal sessions
type Manager struct {
	sessions      map[string]*Session
	lock          sync.RWMutex
	kubeClient    kubernetes.Interface
	sessionExpiry time.Duration
}

// Session represents a terminal session
type Session struct {
	ID        string
	Target    string
	Namespace string
	PodName   string
	Container string
	Created   time.Time
	LastUsed  time.Time
	SizeChan  chan remotecommand.TerminalSize
}

// NewManager creates a new terminal manager
func NewManager(kubeClient kubernetes.Interface) *Manager {
	tm := &Manager{
		sessions:      make(map[string]*Session),
		kubeClient:    kubeClient,
		sessionExpiry: 30 * time.Minute,
	}

	// Start cleanup goroutine
	go tm.cleanupExpiredSessions()

	return tm
}

// CreateSession creates a new terminal session
func (tm *Manager) CreateSession(sessionID, namespace, target string) (string, error) {
	tm.lock.Lock()
	defer tm.lock.Unlock()

	// Generate unique terminal ID
	terminalID := fmt.Sprintf("%s-%s-%d", sessionID, target, time.Now().Unix())

	// Determine pod name based on target
	podName, container, err := tm.getPodForTarget(namespace, target)
	if err != nil {
		return "", err
	}

	// Create session
	session := &Session{
		ID:        terminalID,
		Target:    target,
		Namespace: namespace,
		PodName:   podName,
		Container: container,
		Created:   time.Now(),
		LastUsed:  time.Now(),
		SizeChan:  make(chan remotecommand.TerminalSize),
	}

	// Store session
	tm.sessions[terminalID] = session

	return terminalID, nil
}

// GetSession retrieves a terminal session
func (tm *Manager) GetSession(terminalID string) (*Session, error) {
	tm.lock.RLock()
	defer tm.lock.RUnlock()

	session, ok := tm.sessions[terminalID]
	if !ok {
		return nil, fmt.Errorf("terminal session not found: %s", terminalID)
	}

	// Update last used time
	session.LastUsed = time.Now()

	return session, nil
}

// CloseSession closes a terminal session
func (tm *Manager) CloseSession(terminalID string) error {
	tm.lock.Lock()
	defer tm.lock.Unlock()

	session, ok := tm.sessions[terminalID]
	if !ok {
		return fmt.Errorf("terminal session not found: %s", terminalID)
	}

	// Close size channel
	close(session.SizeChan)

	// Remove session
	delete(tm.sessions, terminalID)

	return nil
}

// HandleTerminal handles a WebSocket connection for a terminal session
func (tm *Manager) HandleTerminal(ctx context.Context, terminalID string, ws *websocket.Conn) error {
	// Get session
	session, err := tm.GetSession(terminalID)
	if err != nil {
		return err
	}

	// Create exec request
	execRequest := tm.createExecRequest(session)

	// Create SPDY executor
	exec, err := remotecommand.NewSPDYExecutor(nil, "POST", execRequest.URL())
	if err != nil {
		return fmt.Errorf("failed to create SPDY executor: %v", err)
	}

	// Create terminal adapter
	adapter := &wsTerminalAdapter{
		WS:       ws,
		SizeChan: session.SizeChan,
	}

	// Execute command
	return exec.Stream(remotecommand.StreamOptions{
		Stdin:             adapter,
		Stdout:            adapter,
		Stderr:            adapter,
		Tty:               true,
		TerminalSizeQueue: adapter,
	})
}

// ResizeTerminal resizes a terminal session
func (tm *Manager) ResizeTerminal(terminalID string, rows, cols uint16) error {
	// Get session
	session, err := tm.GetSession(terminalID)
	if err != nil {
		return err
	}

	// Send resize event
	session.SizeChan <- remotecommand.TerminalSize{
		Width:  uint16(cols),
		Height: uint16(rows),
	}

	return nil
}

// getPodForTarget determines the pod name for a target
func (tm *Manager) getPodForTarget(namespace, target string) (string, string, error) {
	// This is a placeholder - in a real implementation, we would
	// lookup the pod for the VM target using kubevirt client

	// For example:
	// - "control-plane" would map to the control plane VM's pod
	// - "worker-node-1" would map to the first worker node's pod

	// Mock implementation
	podName := fmt.Sprintf("virt-launcher-%s", target)
	container := "compute"

	return podName, container, nil
}

// createExecRequest creates an exec request for a pod
func (tm *Manager) createExecRequest(session *Session) *rest.Request {
	// This is a placeholder - in a real implementation, we would create
	// a proper REST request for the Kubernetes API

	// For example:
	// return tm.kubeClient.CoreV1().RESTClient().Post().
	//     Resource("pods").
	//     Name(session.PodName).
	//     Namespace(session.Namespace).
	//     SubResource("exec").
	//     VersionedParams(&v1.PodExecOptions{
	//         Command:   []string{"/bin/bash"},
	//         Container: session.Container,
	//         Stdin:     true,
	//         Stdout:    true,
	//         Stderr:    true,
	//         TTY:       true,
	//     }, scheme.ParameterCodec)

	// Return mock object
	return nil
}

// cleanupExpiredSessions periodically removes expired sessions
func (tm *Manager) cleanupExpiredSessions() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		<-ticker.C

		tm.lock.Lock()
		expireTime := time.Now().Add(-tm.sessionExpiry)

		// Find expired sessions
		expiredIDs := make([]string, 0)
		for id, session := range tm.sessions {
			if session.LastUsed.Before(expireTime) {
				expiredIDs = append(expiredIDs, id)
			}
		}

		// Close and remove expired sessions
		for _, id := range expiredIDs {
			session := tm.sessions[id]
			close(session.SizeChan)
			delete(tm.sessions, id)
		}

		tm.lock.Unlock()
	}
}

// wsTerminalAdapter adapts between WebSocket and SPDY
type wsTerminalAdapter struct {
	WS       *websocket.Conn
	SizeChan chan remotecommand.TerminalSize
}

// Read reads from the WebSocket
func (a *wsTerminalAdapter) Read(p []byte) (int, error) {
	// Read next message
	_, data, err := a.WS.ReadMessage()
	if err != nil {
		return 0, err
	}

	// Check for resize message
	if len(data) >= 2 && data[0] == 1 {
		// Parse resize message
		width := uint16(data[1])<<8 | uint16(data[2])
		height := uint16(data[3])<<8 | uint16(data[4])

		// Send resize event
		a.SizeChan <- remotecommand.TerminalSize{
			Width:  width,
			Height: height,
		}

		return 0, nil
	}

	// Copy data
	copy(p, data)
	return len(data), nil
}

// Write writes to the WebSocket
func (a *wsTerminalAdapter) Write(p []byte) (int, error) {
	err := a.WS.WriteMessage(websocket.BinaryMessage, p)
	if err != nil {
		return 0, err
	}
	return len(p), nil
}

// Next returns the next terminal size
func (a *wsTerminalAdapter) Next() *remotecommand.TerminalSize {
	size, ok := <-a.SizeChan
	if !ok {
		return nil
	}
	return &size
}
