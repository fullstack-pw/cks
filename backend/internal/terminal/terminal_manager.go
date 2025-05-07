// backend/internal/terminal/terminal_manager.go - Terminal session management

package terminal

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

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
	ID        string
	SessionID string
	Target    string
	Namespace string
	PodName   string
	Container string
	Created   time.Time
	LastUsed  time.Time
	SizeChan  chan remotecommand.TerminalSize
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

	// Get session
	session, err := tm.GetSession(terminalID)
	if err != nil {
		tm.logger.WithError(err).WithField("terminalID", terminalID).Error("Terminal session not found")
		ws.WriteMessage(websocket.TextMessage, []byte("Terminal session not found"))
		return
	}

	tm.logger.WithFields(logrus.Fields{
		"terminalID": terminalID,
		"podName":    session.PodName,
		"namespace":  session.Namespace,
	}).Info("Handling terminal connection")

	// Create SPDY executor
	req := tm.kubeClient.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(session.PodName).
		Namespace(session.Namespace).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: session.Container,
			Command:   []string{"su", "-", "root"},
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

// getPodForTarget determines the pod name for a target VM
func (tm *Manager) getPodForTarget(ctx context.Context, namespace, target string) (string, string, error) {
	// Use KubeVirt client to get pod name for VM
	podName, err := tm.kubevirtClient.GetVMPodName(ctx, namespace, target)
	if err != nil {
		return "", "", fmt.Errorf("failed to get pod name for VM %s: %w", target, err)
	}

	// Default container is "compute" for KubeVirt VMs
	container := "compute"

	return podName, container, nil
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
	err := a.WS.WriteMessage(websocket.BinaryMessage, p)
	if err != nil {
		a.Logger.WithError(err).Debug("Error writing to WebSocket")
		close(a.Done)
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
		// Already closed
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
