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
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

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
	Target           string // VM name
	Namespace        string
	Created          time.Time
	LastUsed         time.Time
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

	// Create session
	session := &Session{
		ID:        terminalID,
		SessionID: sessionID,
		Target:    target,
		Namespace: namespace,
		Created:   time.Now(),
		LastUsed:  time.Now(),
	}

	// Store session
	tm.sessions[terminalID] = session
	tm.logger.WithFields(logrus.Fields{
		"terminalID": terminalID,
		"namespace":  namespace,
		"target":     target,
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

	_, ok := tm.sessions[terminalID]
	if !ok {
		return fmt.Errorf("terminal session not found: %s", terminalID)
	}

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
		session.ConnectionMutex.Lock()
		session.ActiveConnection = false
		session.ConnectionMutex.Unlock()
		return
	}
	defer ws.Close()

	tm.logger.WithFields(logrus.Fields{
		"terminalID": terminalID,
		"vmName":     session.Target,
		"namespace":  session.Namespace,
	}).Info("Handling terminal connection")

	// Create a context with timeout
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()

	// Handle virtctl SSH connection
	tm.handleVirtctlSSHConnection(ctx, session, ws)

	// Mark the session as inactive
	session.ConnectionMutex.Lock()
	session.ActiveConnection = false
	session.ConnectionMutex.Unlock()
}

// ResizeTerminal resizes a terminal session
func (tm *Manager) ResizeTerminal(terminalID string, rows, cols uint16) error {
	// This functionality will be handled through WebSocket messages
	tm.logger.WithFields(logrus.Fields{
		"terminalID": terminalID,
		"rows":       rows,
		"cols":       cols,
	}).Debug("Resize request received")

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
		"-l", "suporte",
		"--local-ssh-opts", "-o StrictHostKeyChecking=no",
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

	tm.logger.WithField("terminalID", session.ID).Info("Terminal session closed")
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

		// Remove expired sessions
		for _, id := range expiredIDs {
			delete(tm.sessions, id)
			tm.logger.WithField("terminalID", id).Info("Terminal session expired and removed")
		}

		tm.lock.Unlock()
	}
}
