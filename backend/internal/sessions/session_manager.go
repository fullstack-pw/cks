// internal/sessions/session_manager.go - SessionManager implementation

package sessions

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/fullstack-pw/cks/backend/internal/config"
	"github.com/fullstack-pw/cks/backend/internal/kubevirt"
	"github.com/fullstack-pw/cks/backend/internal/models"
)

// SessionManager handles the creation, management, and cleanup of user sessions
type SessionManager struct {
	sessions       map[string]*models.Session
	lock           sync.RWMutex
	clientset      *kubernetes.Clientset
	kubevirtClient *kubevirt.Client
	config         *config.Config
	stopCh         chan struct{}
}

// NewSessionManager creates a new session manager
func NewSessionManager(cfg *config.Config) (*SessionManager, error) {
	// Create kubernetes client
	k8sConfig, err := rest.InClusterConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to create in-cluster config: %v", err)
	}

	clientset, err := kubernetes.NewForConfig(k8sConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create clientset: %v", err)
	}

	// Create KubeVirt client
	kubevirtClient, err := kubevirt.NewClient(k8sConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create kubevirt client: %v", err)
	}

	sm := &SessionManager{
		sessions:       make(map[string]*models.Session),
		clientset:      clientset,
		kubevirtClient: kubevirtClient,
		config:         cfg,
		stopCh:         make(chan struct{}),
	}

	// Start session cleanup goroutine
	go sm.cleanupExpiredSessions()

	return sm, nil
}

// CreateSession creates a new user session for a scenario
func (sm *SessionManager) CreateSession(ctx context.Context, scenarioID string) (*models.Session, error) {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	// Check if maximum sessions exceeded
	if len(sm.sessions) >= sm.config.MaxConcurrentSessions {
		return nil, fmt.Errorf("maximum number of concurrent sessions reached")
	}

	// Generate session ID
	sessionID := uuid.New().String()

	// Create namespace name
	namespace := fmt.Sprintf("user-session-%s", sessionID)

	// Create session object
	session := &models.Session{
		ID:               sessionID,
		Namespace:        namespace,
		ScenarioID:       scenarioID,
		Status:           models.SessionStatusPending,
		StartTime:        time.Now(),
		ExpirationTime:   time.Now().Add(time.Duration(sm.config.SessionTimeoutMinutes) * time.Minute),
		ControlPlaneVM:   fmt.Sprintf("cks-control-plane-%s", sessionID),
		WorkerNodeVM:     fmt.Sprintf("cks-worker-node-%s", sessionID),
		Tasks:            make([]models.TaskStatus, 0),
		TerminalSessions: make(map[string]string),
	}

	// Store session
	sm.sessions[sessionID] = session

	// Create namespace asynchronously
	go func() {
		err := sm.provisionEnvironment(ctx, session)
		if err != nil {
			session.Status = models.SessionStatusFailed
			session.StatusMessage = fmt.Sprintf("Failed to provision environment: %v", err)
			return
		}
	}()

	return session, nil
}

// GetSession returns a session by ID
func (sm *SessionManager) GetSession(sessionID string) (*models.Session, error) {
	sm.lock.RLock()
	defer sm.lock.RUnlock()

	session, ok := sm.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	return session, nil
}

// ListSessions returns all active sessions
func (sm *SessionManager) ListSessions() []*models.Session {
	sm.lock.RLock()
	defer sm.lock.RUnlock()

	sessions := make([]*models.Session, 0, len(sm.sessions))
	for _, session := range sm.sessions {
		sessions = append(sessions, session)
	}

	return sessions
}

// DeleteSession deletes a session and cleans up its resources
func (sm *SessionManager) DeleteSession(ctx context.Context, sessionID string) error {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	session, ok := sm.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// Clean up resources asynchronously
	go func() {
		err := sm.cleanupEnvironment(ctx, session)
		if err != nil {
			// Log error but continue with deletion
			fmt.Printf("Error cleaning up session %s: %v\n", sessionID, err)
		}
	}()

	// Remove from session map
	delete(sm.sessions, sessionID)

	return nil
}

// ExtendSession extends the expiration time of a session
func (sm *SessionManager) ExtendSession(sessionID string, duration time.Duration) error {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	session, ok := sm.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// Extend expiration time
	session.ExpirationTime = time.Now().Add(duration)

	return nil
}

// UpdateTaskStatus updates the status of a task in a session
func (sm *SessionManager) UpdateTaskStatus(sessionID, taskID string, status string) error {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	session, ok := sm.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// Find task and update status
	for i, task := range session.Tasks {
		if task.ID == taskID {
			session.Tasks[i].Status = status
			session.Tasks[i].ValidationTime = time.Now()
			return nil
		}
	}

	// Task not found, add it
	session.Tasks = append(session.Tasks, models.TaskStatus{
		ID:             taskID,
		Status:         status,
		ValidationTime: time.Now(),
	})

	return nil
}

// RegisterTerminalSession registers a terminal session for a VM
func (sm *SessionManager) RegisterTerminalSession(sessionID, terminalID, target string) error {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	session, ok := sm.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	session.TerminalSessions[terminalID] = target
	return nil
}

// UnregisterTerminalSession removes a terminal session
func (sm *SessionManager) UnregisterTerminalSession(sessionID, terminalID string) error {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	session, ok := sm.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	delete(session.TerminalSessions, terminalID)
	return nil
}

// provisionEnvironment sets up the Kubernetes environment for a session
func (sm *SessionManager) provisionEnvironment(ctx context.Context, session *models.Session) error {
	// Update session status
	session.Status = models.SessionStatusProvisioning

	// Create namespace
	err := sm.createNamespace(ctx, session.Namespace)
	if err != nil {
		return fmt.Errorf("failed to create namespace: %v", err)
	}

	// Set up resource quotas
	err = sm.setupResourceQuotas(ctx, session.Namespace)
	if err != nil {
		return fmt.Errorf("failed to set up resource quotas: %v", err)
	}

	// Create KubeVirt VMs
	err = sm.kubevirtClient.CreateCluster(ctx, session.Namespace, session.ControlPlaneVM, session.WorkerNodeVM)
	if err != nil {
		return fmt.Errorf("failed to create VMs: %v", err)
	}

	// Wait for VMs to be ready
	err = sm.kubevirtClient.WaitForVMsReady(ctx, session.Namespace, session.ControlPlaneVM, session.WorkerNodeVM)
	if err != nil {
		return fmt.Errorf("failed waiting for VMs: %v", err)
	}

	// Initialize scenario resources if defined
	if session.ScenarioID != "" {
		err = sm.initializeScenario(ctx, session)
		if err != nil {
			return fmt.Errorf("failed to initialize scenario: %v", err)
		}
	}

	// Update session status
	session.Status = models.SessionStatusRunning
	return nil
}

// createNamespace creates a new namespace for the session
func (sm *SessionManager) createNamespace(ctx context.Context, namespace string) error {
	// Create namespace with labels
	ns := &metav1.ObjectMeta{
		Name: namespace,
		Labels: map[string]string{
			"killerkoda.io/session": "true",
		},
	}

	_, err := sm.clientset.CoreV1().Namespaces().Create(ctx, &metav1.Namespace{
		ObjectMeta: *ns,
	}, metav1.CreateOptions{})

	return err
}

// setupResourceQuotas creates resource quotas for the session namespace
func (sm *SessionManager) setupResourceQuotas(ctx context.Context, namespace string) error {
	// Implementation for resource quotas
	// This would create CPU, memory, and storage quotas for the namespace
	return nil
}

// initializeScenario sets up the initial resources for a scenario
func (sm *SessionManager) initializeScenario(ctx context.Context, session *models.Session) error {
	// Load scenario definition
	// Apply scenario resources
	// Initialize task statuses
	return nil
}

// cleanupEnvironment cleans up the Kubernetes resources for a session
func (sm *SessionManager) cleanupEnvironment(ctx context.Context, session *models.Session) error {
	// Delete namespace (which will delete all resources in it)
	err := sm.clientset.CoreV1().Namespaces().Delete(ctx, session.Namespace, metav1.DeleteOptions{})
	return err
}

// cleanupExpiredSessions periodically checks and cleans up expired sessions
func (sm *SessionManager) cleanupExpiredSessions() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			sm.lock.Lock()
			expiredSessions := make([]string, 0)
			now := time.Now()

			// Find expired sessions
			for id, session := range sm.sessions {
				if now.After(session.ExpirationTime) {
					expiredSessions = append(expiredSessions, id)
				}
			}
			sm.lock.Unlock()

			// Clean up expired sessions
			for _, id := range expiredSessions {
				fmt.Printf("Cleaning up expired session: %s\n", id)
				err := sm.DeleteSession(context.Background(), id)
				if err != nil {
					fmt.Printf("Error deleting expired session %s: %v\n", id, err)
				}
			}
		case <-sm.stopCh:
			return
		}
	}
}

// Stop stops the session manager and releases resources
func (sm *SessionManager) Stop() {
	close(sm.stopCh)
}
