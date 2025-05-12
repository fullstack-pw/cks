// backend/internal/terminal/terminal_manager.go - Terminal session management

package terminal

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"github.com/sirupsen/logrus"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/fullstack-pw/cks/backend/internal/kubevirt"
)

// Manager handles terminal sessions
type Manager struct {
	sessions       map[string]*Session
	lock           sync.RWMutex
	kubeClient     kubernetes.Interface
	kubevirtClient *kubevirt.Client
	config         *rest.Config
	sessionExpiry  time.Duration
	logger         *logrus.Logger
}

// Session represents a terminal session
type Session struct {
	ID               string
	SessionID        string
	Target           string
	Namespace        string
	PodName          string
	Container        string
	Created          time.Time
	LastUsed         time.Time
	SizeChan         chan remotecommand.TerminalSize
	ActiveConnection bool
	ConnectionMutex  sync.Mutex
}

// NewManager creates a new terminal manager
func NewManager(kubeClient kubernetes.Interface, kubevirtClient *kubevirt.Client, config *rest.Config, logger *logrus.Logger) *Manager {
	tm := &Manager{
		sessions:       make(map[string]*Session),
		kubeClient:     kubeClient,
		kubevirtClient: kubevirtClient,
		config:         config,
		sessionExpiry:  30 * time.Minute,
		logger:         logger,
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

	// Get pod information for the target VM
	podName, container, err := tm.getPodForTarget(context.Background(), namespace, target)
	if err != nil {
		return "", fmt.Errorf("failed to get pod for target %s: %w", target, err)
	}

	// Create session
	session := &Session{
		ID:        terminalID,
		SessionID: sessionID,
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
	tm.logger.WithFields(logrus.Fields{
		"terminalID": terminalID,
		"namespace":  namespace,
		"target":     target,
		"podName":    podName,
	}).Info("Terminal session created")

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
	tm.logger.WithField("terminalID", terminalID).Info("Terminal session closed")

	return nil
}

// HandleTerminal handles a WebSocket connection for a terminal session
func (tm *Manager) HandleTerminal(w http.ResponseWriter, r *http.Request, terminalID string) {
	// Get session
	session, err := tm.GetSession(terminalID)
	if err != nil {
		tm.logger.WithError(err).WithField("terminalID", terminalID).Error("Terminal session not found")
		http.Error(w, "Terminal session not found", http.StatusNotFound)
		return
	}

	// Check if there's already an active connection
	session.ConnectionMutex.Lock()
	if session.ActiveConnection {
		session.ConnectionMutex.Unlock()
		tm.logger.WithField("terminalID", terminalID).Warn("Connection already exists, rejecting new connection")
		http.Error(w, "Another connection to this terminal is already active", http.StatusConflict)
		return
	}
	session.ActiveConnection = true
	session.ConnectionMutex.Unlock()

	// Set up websocket
	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true // Allow all origins in development; restrict in production
		},
	}

	// Upgrade connection to websocket
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		tm.logger.WithError(err).Error("Failed to upgrade to WebSocket connection")
		http.Error(w, "Failed to upgrade to WebSocket connection", http.StatusInternalServerError)
		return
	}
	defer ws.Close()

	tm.logger.WithFields(logrus.Fields{
		"terminalID": terminalID,
		"vmName":     session.Target,
		"namespace":  session.Namespace,
	}).Info("Handling terminal connection")

	// Create a context with timeout
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	// Check if this is a virtctl SSH connection
	if session.Container == "virtctl-ssh" {
		tm.handleVirtctlSSHConnection(ctx, session, ws)
		return
	}
	// Create SPDY executor
	req := tm.kubeClient.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(session.PodName).
		Namespace(session.Namespace).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: session.Container,
			Command:   []string{"/bin/bash"},
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	exec, err := remotecommand.NewSPDYExecutor(tm.config, "POST", req.URL())
	if err != nil {
		tm.logger.WithError(err).Error("Failed to create SPDY executor")
		ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("Failed to create terminal: %v", err)))
		return
	}

	// Create websocket terminal adapter
	adapter := &wsTerminalAdapter{
		WS:       ws,
		SizeChan: session.SizeChan,
		Done:     make(chan struct{}),
		Logger:   tm.logger.WithField("terminalID", terminalID),
	}

	// Execute command
	tm.logger.WithField("terminalID", terminalID).Info("Starting terminal stream")

	go func() {
		err = exec.Stream(remotecommand.StreamOptions{
			Stdin:             adapter,
			Stdout:            adapter,
			Stderr:            adapter,
			Tty:               true,
			TerminalSizeQueue: adapter,
		})

		if err != nil {
			tm.logger.WithError(err).Error("Terminal stream error")
			adapter.Close()
		}
	}()

	// Wait for done signal
	<-adapter.Done
	tm.logger.WithField("terminalID", terminalID).Info("Terminal stream ended")
	defer func() {
		session.ConnectionMutex.Lock()
		session.ActiveConnection = false
		session.ConnectionMutex.Unlock()
	}()
}

// ResizeTerminal resizes a terminal session
func (tm *Manager) ResizeTerminal(terminalID string, rows, cols uint16) error {
	// Get session
	session, err := tm.GetSession(terminalID)
	if err != nil {
		return err
	}

	tm.logger.WithFields(logrus.Fields{
		"terminalID": terminalID,
		"rows":       rows,
		"cols":       cols,
	}).Debug("Resizing terminal")

	// Send resize event
	session.SizeChan <- remotecommand.TerminalSize{
		Width:  cols,
		Height: rows,
	}

	return nil
}

func (tm *Manager) handleVirtctlSSHConnection(ctx context.Context, session *Session, ws *websocket.Conn) {
	tm.logger.WithFields(logrus.Fields{
		"terminalID": session.ID,
		"vmName":     session.Target,
		"namespace":  session.Namespace,
	}).Info("Starting virtctl SSH terminal session")

	// Create a channel to signal when the connection is done
	done := make(chan struct{})
	defer close(done)

	// Create the virtctl ssh command with proper arguments for interactive use
	args := []string{
		"ssh",
		fmt.Sprintf("vmi/%s", session.Target),
		"-n", session.Namespace,
		"--username=suporte",
		"--known-hosts=/dev/null",
	}

	// Log the exact command being executed
	tm.logger.WithFields(logrus.Fields{
		"command": "virtctl",
		"args":    args,
	}).Debug("Executing virtctl SSH command")

	// Create the command
	cmd := exec.Command("virtctl", args...)

	// Create a pty for the command
	ptmx, err := pty.Start(cmd)
	if err != nil {
		tm.logger.WithError(err).Error("Failed to start pty")
		ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("Failed to create terminal: %v", err)))
		return
	}
	defer ptmx.Close()

	// Set up terminal size if possible
	if err := pty.Setsize(ptmx, &pty.Winsize{
		Rows: 24,
		Cols: 80,
		X:    0,
		Y:    0,
	}); err != nil {
		tm.logger.WithError(err).Warn("Failed to set initial terminal size")
	}

	// Set up a goroutine to handle reading from the pty
	go func() {
		buffer := make([]byte, 4096)
		for {
			select {
			case <-done:
				return
			default:
				n, err := ptmx.Read(buffer)
				if err != nil {
					if err != io.EOF {
						tm.logger.WithError(err).Debug("Error reading from pty")
					}
					return
				}

				if n > 0 {
					if err := ws.WriteMessage(websocket.BinaryMessage, buffer[:n]); err != nil {
						tm.logger.WithError(err).Warn("Error writing to WebSocket")
						return
					}
				}
			}
		}
	}()

	// Set up a goroutine to handle reading from the WebSocket
	go func() {
		for {
			messageType, p, err := ws.ReadMessage()
			if err != nil {
				tm.logger.WithError(err).Debug("WebSocket read error, closing pty")
				return
			}

			// Handle terminal resize messages
			if messageType == websocket.BinaryMessage && len(p) >= 5 && p[0] == 1 {
				width := uint16(p[1])<<8 | uint16(p[2])
				height := uint16(p[3])<<8 | uint16(p[4])

				tm.logger.WithFields(logrus.Fields{
					"width":  width,
					"height": height,
				}).Debug("Terminal resize request")

				// Resize the pty
				if err := pty.Setsize(ptmx, &pty.Winsize{
					Rows: height,
					Cols: width,
					X:    0,
					Y:    0,
				}); err != nil {
					tm.logger.WithError(err).Warn("Failed to resize terminal")
				}
				continue
			}

			// Write data to pty
			if _, err := ptmx.Write(p); err != nil {
				tm.logger.WithError(err).Warn("Error writing to pty")
				return
			}
		}
	}()

	// Wait for the command to complete
	err = cmd.Wait()

	if err != nil {
		tm.logger.WithError(err).Debug("SSH session ended with error")
	} else {
		tm.logger.Info("SSH session ended normally")
	}

	// Mark the session as inactive
	session.ConnectionMutex.Lock()
	session.ActiveConnection = false
	session.ConnectionMutex.Unlock()

	tm.logger.WithField("terminalID", session.ID).Info("Terminal session closed")
}

// testVirtctlConnection tests if virtctl can connect to the VM
func (tm *Manager) testVirtctlConnection(namespace, vmName string) error {
	// Test with a simple command first
	cmd := exec.Command("virtctl", "ssh",
		fmt.Sprintf("vmi/%s", vmName),
		"-n", namespace,
		"-l", "suporte",
		"--local-ssh-opts", "-o StrictHostKeyChecking=no",
		"--command", "echo test",
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("virtctl connection test failed: %v, output: %s", err, string(output))
	}

	return nil
}

func (tm *Manager) getPodForTarget(ctx context.Context, namespace, target string) (string, string, error) {
	// For virtctl SSH, we don't need to find a pod
	// Instead, we'll return the VM name directly, and a special indicator for using SSH
	return target, "virtctl-ssh", nil
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
			tm.logger.WithField("terminalID", id).Info("Terminal session expired and removed")
		}

		tm.lock.Unlock()
	}
}

// wsTerminalAdapter adapts between WebSocket and SPDY
type wsTerminalAdapter struct {
	WS       *websocket.Conn
	SizeChan chan remotecommand.TerminalSize
	Done     chan struct{}
	Logger   *logrus.Entry
}

// Read reads from the WebSocket
func (a *wsTerminalAdapter) Read(p []byte) (int, error) {
	// Read next message
	messageType, data, err := a.WS.ReadMessage()
	if err != nil {
		a.Logger.WithError(err).Debug("Error reading from WebSocket")
		close(a.Done)
		return 0, err
	}

	// Handle binary message (resize message)
	if messageType == websocket.BinaryMessage && len(data) >= 5 && data[0] == 1 {
		// Parse resize message (1 byte type + 4 bytes dimensions)
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
	// Check if the connection is already closed
	select {
	case <-a.Done:
		return 0, fmt.Errorf("connection closed")
	default:
		// Continue with write operation
	}

	err := a.WS.WriteMessage(websocket.BinaryMessage, p)
	if err != nil {
		a.Logger.WithError(err).Debug("Error writing to WebSocket")
		// Instead of directly closing the Done channel, use the Close method
		a.Close()
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

// Close signals that the terminal session is done
func (a *wsTerminalAdapter) Close() {
	select {
	case <-a.Done:
		// Already closed, do nothing
	default:
		close(a.Done)
	}
}

// Message types for terminal io
type TerminalMessage struct {
	Op   string `json:"op"`
	Data string `json:"data,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
	Cols uint16 `json:"cols,omitempty"`
}
