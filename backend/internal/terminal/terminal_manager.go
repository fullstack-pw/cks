// backend/internal/terminal/terminal_manager.go - Terminal session management

package terminal

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"github.com/sirupsen/logrus"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/fullstack-pw/cks/backend/internal/kubevirt"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type PersistentSSHConnection struct {
	ID          string
	SessionID   string
	Target      string
	Namespace   string
	Command     *exec.Cmd
	PTY         *os.File
	Created     time.Time
	LastUsed    time.Time
	ActiveConns int // Number of active WebSocket connections
	Mutex       sync.Mutex
}

type Manager struct {
	sessions          map[string]*Session
	persistentSSH     map[string]*PersistentSSHConnection // Key: sessionID-target
	lock              sync.RWMutex
	persistentSSHLock sync.RWMutex
	kubeClient        kubernetes.Interface
	kubevirtClient    *kubevirt.Client
	config            *rest.Config
	sessionExpiry     time.Duration
	logger            *logrus.Logger
}

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

func NewManager(kubeClient kubernetes.Interface, kubevirtClient *kubevirt.Client, config *rest.Config, logger *logrus.Logger) *Manager {
	tm := &Manager{
		sessions:       make(map[string]*Session),
		persistentSSH:  make(map[string]*PersistentSSHConnection),
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

// CreateSession creates a new terminal session or reuses existing one
func (tm *Manager) CreateSession(sessionID, namespace, target string) (string, error) {
	tm.lock.Lock()
	defer tm.lock.Unlock()

	// Generate deterministic terminal ID based on session and target
	terminalID := fmt.Sprintf("%s-%s", sessionID, target)

	// Check if terminal session already exists
	if existingSession, exists := tm.sessions[terminalID]; exists {
		// Update last used time
		existingSession.LastUsed = time.Now()

		tm.logger.WithFields(logrus.Fields{
			"terminalID": terminalID,
			"sessionID":  sessionID,
			"target":     target,
		}).Info("Reusing existing terminal session")

		return terminalID, nil
	}

	// Create new session
	session := &Session{
		ID:               terminalID,
		SessionID:        sessionID,
		Target:           target,
		Namespace:        namespace,
		Created:          time.Now(),
		LastUsed:         time.Now(),
		ActiveConnection: false,
	}

	// Store session
	tm.sessions[terminalID] = session
	tm.logger.WithFields(logrus.Fields{
		"terminalID": terminalID,
		"namespace":  namespace,
		"target":     target,
	}).Info("New terminal session created with deterministic ID")

	return terminalID, nil
}

// GetSession retrieves a terminal session or recreates it if it matches the expected pattern
func (tm *Manager) GetSession(terminalID string) (*Session, error) {
	tm.lock.RLock()
	session, exists := tm.sessions[terminalID]
	tm.lock.RUnlock()

	if exists {
		// Update last used time
		session.LastUsed = time.Now()
		return session, nil
	}

	// Check if this is a valid terminal ID pattern (sessionID-target)
	// Expected format: "xxxxxxxx-control-plane" or "xxxxxxxx-worker-node"
	if !tm.isValidTerminalID(terminalID) {
		return nil, fmt.Errorf("terminal session not found: %s", terminalID)
	}

	// Extract sessionID and target from terminalID
	parts := strings.Split(terminalID, "-")
	if len(parts) < 2 {
		return nil, fmt.Errorf("invalid terminal ID format: %s", terminalID)
	}

	sessionID := parts[0]
	target := strings.Join(parts[1:], "-") // Handle "control-plane" and "worker-node"

	tm.logger.WithFields(logrus.Fields{
		"terminalID": terminalID,
		"sessionID":  sessionID,
		"target":     target,
	}).Info("Auto-creating terminal session for reconnection")

	// We need namespace info, but we can derive it from the pattern
	// For cluster pool, namespace is "cluster1", "cluster2", or "cluster3"
	// We'll need to get this from somewhere... for now, let's add a method to find it
	namespace := tm.findNamespaceForSession(sessionID)
	if namespace == "" {
		return nil, fmt.Errorf("cannot determine namespace for session: %s", sessionID)
	}

	// Create the session
	tm.lock.Lock()
	defer tm.lock.Unlock()

	// Double-check it wasn't created while we were waiting for the lock
	if existingSession, exists := tm.sessions[terminalID]; exists {
		existingSession.LastUsed = time.Now()
		return existingSession, nil
	}

	// Create new session
	session = &Session{
		ID:               terminalID,
		SessionID:        sessionID,
		Target:           target,
		Namespace:        namespace,
		Created:          time.Now(),
		LastUsed:         time.Now(),
		ActiveConnection: false,
	}

	tm.sessions[terminalID] = session
	tm.logger.WithFields(logrus.Fields{
		"terminalID": terminalID,
		"namespace":  namespace,
		"target":     target,
	}).Info("Terminal session auto-created for reconnection")

	return session, nil
}

// Add helper method to validate terminal ID format
func (tm *Manager) isValidTerminalID(terminalID string) bool {
	// Must match pattern: 8chars-target where target is "control-plane" or "worker-node"
	pattern := `^[a-f0-9]{8}-(control-plane|worker-node)$`
	matched, _ := regexp.MatchString(pattern, terminalID)
	return matched
}

// Add helper method to find namespace for a session
func (tm *Manager) findNamespaceForSession(sessionID string) string {
	// For cluster pool implementation, we need to check which cluster the session is assigned to
	// This is a simplified version - in production, you'd query the session service

	// Try cluster1, cluster2, cluster3 (for cluster pool)
	namespaces := []string{"cluster1", "cluster2", "cluster3"}

	// Also try the session-based namespace pattern
	namespaces = append(namespaces, fmt.Sprintf("cks-%s", sessionID))

	// Check if any VMs exist in these namespaces
	for _, ns := range namespaces {
		// Quick check if namespace exists and has VMs
		vms, err := tm.kubevirtClient.VirtClient().VirtualMachine(ns).List(context.Background(), metav1.ListOptions{})
		if err == nil && len(vms.Items) > 0 {
			tm.logger.WithFields(logrus.Fields{
				"sessionID": sessionID,
				"namespace": ns,
			}).Debug("Found namespace for session")
			return ns
		}
	}

	return ""
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

func (tm *Manager) HandleTerminal(w http.ResponseWriter, r *http.Request, terminalID string) {
	// Get session
	session, err := tm.GetSession(terminalID)
	if err != nil {
		tm.logger.WithError(err).WithField("terminalID", terminalID).Error("Terminal session not found")
		http.Error(w, "Terminal session not found", http.StatusNotFound)
		return
	}

	// Only handle control-plane with persistent connections for now
	if !strings.Contains(session.Target, "control-plane") {
		tm.logger.WithField("target", session.Target).Info("Using legacy connection for non-control-plane target")
		tm.handleLegacyTerminalConnection(w, r, session)
		return
	}

	// Check if there's already an active connection
	session.ConnectionMutex.Lock()
	if session.ActiveConnection {
		session.ConnectionMutex.Unlock()
		tm.logger.WithField("terminalID", terminalID).Info("Existing connection found, allowing persistent reconnection")
		// Allow reconnection - don't reject, just proceed
	} else {
		session.ActiveConnection = true
		session.ConnectionMutex.Unlock()
	}

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
	defer func() {
		ws.Close()
		session.ConnectionMutex.Lock()
		session.ActiveConnection = false
		session.ConnectionMutex.Unlock()
	}()

	tm.logger.WithFields(logrus.Fields{
		"terminalID": terminalID,
		"vmName":     session.Target,
		"namespace":  session.Namespace,
	}).Info("Handling persistent terminal connection")

	// Get or create persistent SSH connection
	sshConn, err := tm.GetOrCreatePersistentSSH(session.SessionID, session.Namespace, "control-plane")
	if err != nil {
		tm.logger.WithError(err).Error("Failed to get persistent SSH connection")
		ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("Failed to create persistent terminal: %v", err)))
		return
	}

	// Attach WebSocket to persistent SSH connection
	err = tm.AttachToPersistentSSH(sshConn, ws)
	if err != nil {
		tm.logger.WithError(err).Error("Failed to attach to persistent SSH connection")
		ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("Failed to attach to terminal: %v", err)))
		return
	}

	tm.logger.WithField("terminalID", terminalID).Info("Persistent terminal session ended")
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

// handleVirtctlSSHConnection handles legacy (non-persistent) SSH connections
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

		// Clean up persistent SSH connections for expired sessions
		tm.cleanupExpiredPersistentSSH()
	}
}

// cleanupExpiredPersistentSSH cleans up persistent SSH connections for expired sessions
func (tm *Manager) cleanupExpiredPersistentSSH() {
	tm.persistentSSHLock.Lock()
	defer tm.persistentSSHLock.Unlock()

	expireTime := time.Now().Add(-tm.sessionExpiry)
	expiredConnections := make([]string, 0)

	// Find expired persistent SSH connections
	for connectionKey, conn := range tm.persistentSSH {
		// Check if connection hasn't been used recently
		if conn.LastUsed.Before(expireTime) {
			// Also check if there are no active WebSocket connections
			conn.Mutex.Lock()
			activeConns := conn.ActiveConns
			conn.Mutex.Unlock()

			if activeConns == 0 {
				expiredConnections = append(expiredConnections, connectionKey)
			} else {
				tm.logger.WithFields(logrus.Fields{
					"connectionKey": connectionKey,
					"activeConns":   activeConns,
				}).Debug("Persistent SSH connection has active connections, keeping alive")
			}
		}
	}

	// Clean up expired connections
	for _, connectionKey := range expiredConnections {
		if conn, exists := tm.persistentSSH[connectionKey]; exists {
			tm.logger.WithField("connectionKey", connectionKey).Info("Cleaning up expired persistent SSH connection")
			tm.cleanupDeadSSHConnection(conn)
			delete(tm.persistentSSH, connectionKey)
		}
	}

	if len(expiredConnections) > 0 {
		tm.logger.WithField("cleanedUp", len(expiredConnections)).Info("Cleaned up expired persistent SSH connections")
	}
}

// CleanupSessionSSH cleans up all persistent SSH connections for a session
func (tm *Manager) CleanupSessionSSH(sessionID string) {
	tm.persistentSSHLock.Lock()
	defer tm.persistentSSHLock.Unlock()

	connectionsToCleanup := make([]*PersistentSSHConnection, 0)
	keysToDelete := make([]string, 0)

	// Find all connections for this session
	for connectionKey, conn := range tm.persistentSSH {
		if conn.SessionID == sessionID {
			connectionsToCleanup = append(connectionsToCleanup, conn)
			keysToDelete = append(keysToDelete, connectionKey)
		}
	}

	// Clean up the connections
	for i, conn := range connectionsToCleanup {
		connectionKey := keysToDelete[i]
		tm.logger.WithFields(logrus.Fields{
			"sessionID":     sessionID,
			"connectionKey": connectionKey,
		}).Info("Cleaning up persistent SSH connection for deleted session")

		tm.cleanupDeadSSHConnection(conn)
		delete(tm.persistentSSH, connectionKey)
	}

	if len(connectionsToCleanup) > 0 {
		tm.logger.WithFields(logrus.Fields{
			"sessionID": sessionID,
			"cleanedUp": len(connectionsToCleanup),
		}).Info("Cleaned up persistent SSH connections for session")
	}
}

// GetOrCreatePersistentSSH gets existing or creates new persistent SSH connection
func (tm *Manager) GetOrCreatePersistentSSH(sessionID, namespace, target string) (*PersistentSSHConnection, error) {
	// Only handle control-plane for now
	if target != "control-plane" {
		return nil, fmt.Errorf("persistent SSH only supported for control-plane currently")
	}

	connectionKey := fmt.Sprintf("%s-%s", sessionID, target)

	tm.persistentSSHLock.Lock()
	defer tm.persistentSSHLock.Unlock()

	// Check if connection already exists
	if conn, exists := tm.persistentSSH[connectionKey]; exists {
		// Verify the SSH process is still alive
		if tm.isSSHProcessAlive(conn) {
			conn.LastUsed = time.Now()
			tm.logger.WithFields(logrus.Fields{
				"connectionKey": connectionKey,
				"sessionID":     sessionID,
				"target":        target,
			}).Info("Reusing existing persistent SSH connection")
			return conn, nil
		} else {
			// Process died, clean it up and create new one
			tm.logger.WithField("connectionKey", connectionKey).Warn("Persistent SSH process died, recreating")
			tm.cleanupDeadSSHConnection(conn)
			delete(tm.persistentSSH, connectionKey)
		}
	}

	// Create new persistent SSH connection
	conn, err := tm.createPersistentSSHConnection(sessionID, namespace, target, connectionKey)
	if err != nil {
		return nil, fmt.Errorf("failed to create persistent SSH connection: %w", err)
	}

	tm.persistentSSH[connectionKey] = conn
	tm.logger.WithFields(logrus.Fields{
		"connectionKey": connectionKey,
		"sessionID":     sessionID,
		"target":        target,
	}).Info("Created new persistent SSH connection")

	return conn, nil
}

// createPersistentSSHConnection creates a new persistent SSH connection
func (tm *Manager) createPersistentSSHConnection(sessionID, namespace, target, connectionKey string) (*PersistentSSHConnection, error) {
	// Get the actual VM name for the target
	vmName, err := tm.getVMNameForTarget(sessionID, namespace, target)
	if err != nil {
		return nil, fmt.Errorf("failed to get VM name: %w", err)
	}

	// Create the virtctl ssh command
	args := []string{
		"ssh",
		fmt.Sprintf("vmi/%s", vmName),
		"-n", namespace,
		"-l", "suporte",
		"--local-ssh-opts", "-o StrictHostKeyChecking=no",
	}

	tm.logger.WithFields(logrus.Fields{
		"command":       "virtctl",
		"args":          args,
		"connectionKey": connectionKey,
	}).Debug("Creating persistent SSH connection")

	// Create the command
	cmd := exec.Command("virtctl", args...)

	// Create a pty for the command
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to start pty for persistent SSH: %w", err)
	}

	// Set up initial terminal size
	if err := pty.Setsize(ptmx, &pty.Winsize{
		Rows: 24,
		Cols: 80,
		X:    0,
		Y:    0,
	}); err != nil {
		tm.logger.WithError(err).Warn("Failed to set initial terminal size for persistent SSH")
	}

	conn := &PersistentSSHConnection{
		ID:          connectionKey,
		SessionID:   sessionID,
		Target:      target,
		Namespace:   namespace,
		Command:     cmd,
		PTY:         ptmx,
		Created:     time.Now(),
		LastUsed:    time.Now(),
		ActiveConns: 0,
	}

	return conn, nil
}

// getVMNameForTarget gets the actual VM name for a target
func (tm *Manager) getVMNameForTarget(sessionID, namespace, target string) (string, error) {
	// For control-plane in cluster pool, the VM name follows pattern: cp-clusterX
	// We need to find which cluster this session is using

	// Try cluster1, cluster2, cluster3 pattern first
	clusterPatterns := []string{"cp-cluster1", "cp-cluster2", "cp-cluster3"}

	for _, vmName := range clusterPatterns {
		// Check if VM exists in this namespace
		_, err := tm.kubevirtClient.VirtClient().VirtualMachine(namespace).Get(context.Background(), vmName, metav1.GetOptions{})
		if err == nil {
			return vmName, nil
		}
	}

	// Fallback: try session-based naming
	vmName := fmt.Sprintf("cp-%s", sessionID)
	return vmName, nil
}

// isSSHProcessAlive checks if the SSH process is still running
func (tm *Manager) isSSHProcessAlive(conn *PersistentSSHConnection) bool {
	if conn.Command == nil || conn.Command.Process == nil {
		return false
	}

	// Check if process is still running
	err := conn.Command.Process.Signal(os.Signal(syscall.Signal(0)))
	return err == nil
}

// AttachToPersistentSSH attaches a WebSocket to existing SSH connection
func (tm *Manager) AttachToPersistentSSH(sshConn *PersistentSSHConnection, ws *websocket.Conn) error {
	sshConn.Mutex.Lock()
	sshConn.ActiveConns++
	sshConn.LastUsed = time.Now()
	activeConns := sshConn.ActiveConns
	sshConn.Mutex.Unlock()

	tm.logger.WithFields(logrus.Fields{
		"connectionID": sshConn.ID,
		"activeConns":  activeConns,
	}).Info("WebSocket attached to persistent SSH")

	// Set up communication between WebSocket and SSH
	return tm.bridgeWebSocketToSSH(sshConn, ws)
}

// DetachFromPersistentSSH detaches WebSocket from SSH connection
func (tm *Manager) DetachFromPersistentSSH(sshConn *PersistentSSHConnection) {
	sshConn.Mutex.Lock()
	if sshConn.ActiveConns > 0 {
		sshConn.ActiveConns--
	}
	activeConns := sshConn.ActiveConns
	sshConn.Mutex.Unlock()

	tm.logger.WithFields(logrus.Fields{
		"connectionID": sshConn.ID,
		"activeConns":  activeConns,
	}).Info("WebSocket detached from persistent SSH")
}

// CleanupPersistentSSH closes SSH connection when session ends
func (tm *Manager) CleanupPersistentSSH(sessionID, target string) error {
	connectionKey := fmt.Sprintf("%s-%s", sessionID, target)

	tm.persistentSSHLock.Lock()
	defer tm.persistentSSHLock.Unlock()

	conn, exists := tm.persistentSSH[connectionKey]
	if !exists {
		return nil // Already cleaned up
	}

	tm.logger.WithField("connectionKey", connectionKey).Info("Cleaning up persistent SSH connection")

	tm.cleanupDeadSSHConnection(conn)
	delete(tm.persistentSSH, connectionKey)

	return nil
}

// cleanupDeadSSHConnection cleans up resources for a dead SSH connection
func (tm *Manager) cleanupDeadSSHConnection(conn *PersistentSSHConnection) {
	if conn.PTY != nil {
		conn.PTY.Close()
	}

	if conn.Command != nil && conn.Command.Process != nil {
		conn.Command.Process.Kill()
		conn.Command.Wait() // Wait for process to finish
	}
}

// bridgeWebSocketToSSH handles communication between WebSocket and SSH
func (tm *Manager) bridgeWebSocketToSSH(sshConn *PersistentSSHConnection, ws *websocket.Conn) error {
	// Create a channel to signal when the connection is done
	done := make(chan struct{})
	defer close(done)

	// Ensure we detach when done
	defer tm.DetachFromPersistentSSH(sshConn)

	// Set up a goroutine to handle reading from the SSH pty
	go func() {
		buffer := make([]byte, 4096)
		for {
			select {
			case <-done:
				return
			default:
				n, err := sshConn.PTY.Read(buffer)
				if err != nil {
					if err != io.EOF {
						tm.logger.WithError(err).Debug("Error reading from persistent SSH pty")
					}
					return
				}

				if n > 0 {
					if err := ws.WriteMessage(websocket.BinaryMessage, buffer[:n]); err != nil {
						tm.logger.WithError(err).Warn("Error writing to WebSocket from persistent SSH")
						return
					}
				}
			}
		}
	}()

	// Handle reading from the WebSocket
	for {
		messageType, p, err := ws.ReadMessage()
		if err != nil {
			tm.logger.WithError(err).Debug("WebSocket read error in persistent SSH bridge")
			return nil
		}

		// Handle terminal resize messages
		if messageType == websocket.BinaryMessage && len(p) >= 5 && p[0] == 1 {
			width := uint16(p[1])<<8 | uint16(p[2])
			height := uint16(p[3])<<8 | uint16(p[4])

			tm.logger.WithFields(logrus.Fields{
				"width":  width,
				"height": height,
			}).Debug("Terminal resize request for persistent SSH")

			// Resize the pty
			if err := pty.Setsize(sshConn.PTY, &pty.Winsize{
				Rows: height,
				Cols: width,
				X:    0,
				Y:    0,
			}); err != nil {
				tm.logger.WithError(err).Warn("Failed to resize persistent SSH terminal")
			}
			continue
		}

		// Write data to pty
		if _, err := sshConn.PTY.Write(p); err != nil {
			tm.logger.WithError(err).Warn("Error writing to persistent SSH pty")
			return nil
		}
	}
}

// handleLegacyTerminalConnection handles non-persistent connections (for worker nodes)
func (tm *Manager) handleLegacyTerminalConnection(w http.ResponseWriter, r *http.Request, session *Session) {
	// Set up websocket
	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}

	// Upgrade connection to websocket
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		tm.logger.WithError(err).Error("Failed to upgrade to WebSocket connection")
		return
	}
	defer ws.Close()

	tm.logger.WithFields(logrus.Fields{
		"terminalID": session.ID,
		"vmName":     session.Target,
		"namespace":  session.Namespace,
	}).Info("Handling legacy terminal connection")

	// Create a context with timeout
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()

	// Handle virtctl SSH connection (original implementation)
	tm.handleVirtctlSSHConnection(ctx, session, ws)
}
