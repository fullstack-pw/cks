// backend/internal/sessions/session_manager.go - SessionManager implementation

package sessions

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/sirupsen/logrus"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/kubernetes"

	"github.com/fullstack-pw/cks/backend/internal/config"
	"github.com/fullstack-pw/cks/backend/internal/kubevirt"
	"github.com/fullstack-pw/cks/backend/internal/models"
	"github.com/fullstack-pw/cks/backend/internal/scenarios"
	"github.com/fullstack-pw/cks/backend/internal/validation"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
)

// SessionManager handles the creation, management, and cleanup of user sessions
type SessionManager struct {
	sessions         map[string]*models.Session
	lock             sync.RWMutex
	clientset        *kubernetes.Clientset
	kubevirtClient   *kubevirt.Client
	config           *config.Config
	validationEngine *validation.Engine
	logger           *logrus.Logger
	stopCh           chan struct{}
	scenarioManager  *scenarios.ScenarioManager
}

func NewSessionManager(
	cfg *config.Config,
	clientset *kubernetes.Clientset,
	kubevirtClient *kubevirt.Client,
	validationEngine *validation.Engine,
	logger *logrus.Logger,
	scenarioManager *scenarios.ScenarioManager, // Add this parameter
) (*SessionManager, error) {
	sm := &SessionManager{
		sessions:         make(map[string]*models.Session),
		clientset:        clientset,
		kubevirtClient:   kubevirtClient,
		config:           cfg,
		validationEngine: validationEngine,
		logger:           logger,
		stopCh:           make(chan struct{}),
		scenarioManager:  scenarioManager, // Add this
	}

	// Start session cleanup goroutine
	go sm.cleanupExpiredSessions()

	return sm, nil
}

func (sm *SessionManager) CreateSession(ctx context.Context, scenarioID string) (*models.Session, error) {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	// Check if maximum sessions exceeded
	if len(sm.sessions) >= sm.config.MaxConcurrentSessions {
		return nil, fmt.Errorf("maximum number of concurrent sessions reached")
	}

	// Generate session ID
	sessionID := uuid.New().String()[:8] // Short ID for better user experience

	// Create namespace name
	namespace := fmt.Sprintf("user-session-%s", sessionID)

	// Load scenario to get task info
	var tasks []models.TaskStatus
	if scenarioID != "" {
		scenario, err := sm.loadScenario(ctx, scenarioID)
		if err != nil {
			sm.logger.WithError(err).WithField("scenarioID", scenarioID).Warn("Failed to load scenario")
			// Continue without scenario info
		} else if scenario != nil {
			// Initialize task statuses
			tasks = make([]models.TaskStatus, 0, len(scenario.Tasks))
			for _, task := range scenario.Tasks {
				tasks = append(tasks, models.TaskStatus{
					ID:     task.ID,
					Status: "pending",
				})
			}
		}
	}

	// Create session object
	session := &models.Session{
		ID:               sessionID,
		Namespace:        namespace,
		ScenarioID:       scenarioID,
		Status:           models.SessionStatusPending,
		StartTime:        time.Now(),
		ExpirationTime:   time.Now().Add(time.Duration(sm.config.SessionTimeoutMinutes) * time.Minute),
		ControlPlaneVM:   fmt.Sprintf("cks-control-plane-user-session-%s", sessionID),
		WorkerNodeVM:     fmt.Sprintf("cks-worker-node-user-session-%s", sessionID),
		Tasks:            tasks,
		TerminalSessions: make(map[string]string),
	}

	// Store session
	sm.sessions[sessionID] = session

	sm.logger.WithFields(logrus.Fields{
		"sessionID":  sessionID,
		"namespace":  namespace,
		"scenarioID": scenarioID,
	}).Info("Creating new session")

	// Create namespace asynchronously with a new background context
	go func() {
		// Create a new background context with a longer timeout
		provisionCtx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()

		err := sm.provisionEnvironment(provisionCtx, session)
		if err != nil {
			sm.logger.WithError(err).WithField("sessionID", sessionID).Error("Failed to provision environment")

			// Update session status
			sm.lock.Lock()
			session.Status = models.SessionStatusFailed
			session.StatusMessage = fmt.Sprintf("Failed to provision environment: %v", err)
			sm.lock.Unlock()
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
	session, ok := sm.sessions[sessionID]
	if !ok {
		sm.lock.Unlock()
		return fmt.Errorf("session not found: %s", sessionID)
	}
	sm.lock.Unlock()

	sm.logger.WithField("sessionID", sessionID).Info("Deleting session")

	// Clean up resources asynchronously
	go func() {
		err := sm.cleanupEnvironment(ctx, session)
		if err != nil {
			// Log error but continue with deletion
			sm.logger.WithError(err).WithField("sessionID", sessionID).Error("Error cleaning up session")
		}

		// Remove from session map
		sm.lock.Lock()
		delete(sm.sessions, sessionID)
		sm.lock.Unlock()
	}()

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

	sm.logger.WithFields(logrus.Fields{
		"sessionID":      sessionID,
		"expirationTime": session.ExpirationTime,
	}).Info("Session extended")

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
	found := false
	for i, task := range session.Tasks {
		if task.ID == taskID {
			session.Tasks[i].Status = status
			session.Tasks[i].ValidationTime = time.Now()
			found = true
			break
		}
	}

	// Task not found, add it
	if !found {
		session.Tasks = append(session.Tasks, models.TaskStatus{
			ID:             taskID,
			Status:         status,
			ValidationTime: time.Now(),
		})
	}

	sm.logger.WithFields(logrus.Fields{
		"sessionID": sessionID,
		"taskID":    taskID,
		"status":    status,
	}).Info("Task status updated")

	return nil
}

// ValidateTask validates a task in a session
func (sm *SessionManager) ValidateTask(ctx context.Context, sessionID, taskID string) (*models.ValidationResponse, error) {
	// Get session
	session, err := sm.GetSession(sessionID)
	if err != nil {
		return nil, err
	}

	// Get scenario to load task validation rules
	scenario, err := sm.loadScenario(ctx, session.ScenarioID)
	if err != nil {
		return nil, fmt.Errorf("failed to load scenario: %w", err)
	}

	// Find task in scenario
	var taskToValidate *models.Task
	for _, task := range scenario.Tasks {
		if task.ID == taskID {
			taskToValidate = &task
			break
		}
	}

	if taskToValidate == nil {
		return nil, fmt.Errorf("task not found in scenario: %s", taskID)
	}

	// Validate task
	result, err := sm.validationEngine.ValidateTask(ctx, session, *taskToValidate)
	if err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Update task status
	status := "failed"
	if result.Success {
		status = "completed"
	}

	err = sm.UpdateTaskStatus(sessionID, taskID, status)
	if err != nil {
		sm.logger.WithError(err).WithFields(logrus.Fields{
			"sessionID": sessionID,
			"taskID":    taskID,
		}).Error("Failed to update task status")
		// Continue despite error
	}

	return result, nil
}

// RegisterTerminalSession registers a terminal session for a VM
func (sm *SessionManager) RegisterTerminalSession(sessionID, terminalID, target string) error {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	session, ok := sm.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// Initialize map if nil
	if session.TerminalSessions == nil {
		session.TerminalSessions = make(map[string]string)
	}

	session.TerminalSessions[terminalID] = target

	sm.logger.WithFields(logrus.Fields{
		"sessionID":  sessionID,
		"terminalID": terminalID,
		"target":     target,
	}).Debug("Terminal session registered")

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

	// Check if TerminalSessions map exists
	if session.TerminalSessions == nil {
		return nil // Nothing to unregister
	}

	delete(session.TerminalSessions, terminalID)

	sm.logger.WithFields(logrus.Fields{
		"sessionID":  sessionID,
		"terminalID": terminalID,
	}).Debug("Terminal session unregistered")

	return nil
}

func (sm *SessionManager) provisionEnvironment(ctx context.Context, session *models.Session) error {
	// Update session status with proper locking
	if err := sm.UpdateSessionStatus(session.ID, models.SessionStatusProvisioning, ""); err != nil {
		return fmt.Errorf("failed to update session status: %w", err)
	}

	sm.logger.WithField("sessionID", session.ID).Info("Provisioning environment")

	// Verify KubeVirt is available
	err := sm.kubevirtClient.VerifyKubeVirtAvailable(ctx)
	if err != nil {
		sm.logger.WithError(err).Error("Failed to verify KubeVirt availability")
		// Update status to failed
		sm.UpdateSessionStatus(session.ID, models.SessionStatusFailed, fmt.Sprintf("Failed to verify KubeVirt availability: %v", err))
		return fmt.Errorf("failed to verify KubeVirt availability: %w", err)
	}

	// Create namespace
	namespaceCtx, cancelNamespace := context.WithTimeout(ctx, 2*time.Minute)
	defer cancelNamespace()
	err = sm.createNamespace(namespaceCtx, session.Namespace)
	if err != nil {
		// Update status to failed
		sm.UpdateSessionStatus(session.ID, models.SessionStatusFailed, fmt.Sprintf("Failed to create namespace: %v", err))
		return fmt.Errorf("failed to create namespace: %w", err)
	}

	// Add a short delay to ensure the namespace is fully created
	time.Sleep(2 * time.Second)

	// Set up resource quotas
	quotaCtx, cancelQuota := context.WithTimeout(ctx, 2*time.Minute)
	defer cancelQuota()
	sm.logger.WithField("namespace", session.Namespace).Info("Setting up resource quotas")
	err = sm.setupResourceQuotas(quotaCtx, session.Namespace)
	if err != nil {
		// Update status to failed
		sm.UpdateSessionStatus(session.ID, models.SessionStatusFailed, fmt.Sprintf("Failed to set up resource quotas: %v", err))
		return fmt.Errorf("failed to set up resource quotas: %w", err)
	}

	// Add a short delay to ensure resource quotas are applied
	time.Sleep(2 * time.Second)

	// Create KubeVirt VMs
	vmCtx, cancelVM := context.WithTimeout(ctx, 10*time.Minute)
	defer cancelVM()
	sm.logger.WithField("sessionID", session.ID).Info("Creating KubeVirt VMs")
	err = sm.kubevirtClient.CreateCluster(vmCtx, session.Namespace, session.ControlPlaneVM, session.WorkerNodeVM)
	if err != nil {
		// Update status to failed
		sm.UpdateSessionStatus(session.ID, models.SessionStatusFailed, fmt.Sprintf("Failed to create VMs: %v", err))
		return fmt.Errorf("failed to create VMs: %w", err)
	}

	// Wait for VMs to be ready
	waitCtx, cancelWait := context.WithTimeout(ctx, 15*time.Minute)
	defer cancelWait()
	sm.logger.WithField("sessionID", session.ID).Info("Waiting for VMs to be ready")
	err = sm.kubevirtClient.WaitForVMsReady(waitCtx, session.Namespace, session.ControlPlaneVM, session.WorkerNodeVM)
	if err != nil {
		// Update status to failed
		sm.UpdateSessionStatus(session.ID, models.SessionStatusFailed, fmt.Sprintf("Failed waiting for VMs: %v", err))
		return fmt.Errorf("failed waiting for VMs: %w", err)
	}

	// Initialize scenario resources if defined
	if session.ScenarioID != "" {
		scenarioCtx, cancelScenario := context.WithTimeout(ctx, 5*time.Minute)
		defer cancelScenario()
		sm.logger.WithField("sessionID", session.ID).Info("Initializing scenario")
		err = sm.initializeScenario(scenarioCtx, session)
		if err != nil {
			// Update status to failed
			sm.UpdateSessionStatus(session.ID, models.SessionStatusFailed, fmt.Sprintf("Failed to initialize scenario: %v", err))
			return fmt.Errorf("failed to initialize scenario: %w", err)
		}
	}

	// Update final status with proper locking
	if err := sm.UpdateSessionStatus(session.ID, models.SessionStatusRunning, ""); err != nil {
		return fmt.Errorf("failed to update session status: %w", err)
	}

	sm.logger.WithField("sessionID", session.ID).Info("Environment provisioned successfully")
	return nil
}

// createNamespace creates a new namespace for the session
func (sm *SessionManager) createNamespace(ctx context.Context, namespace string) error {
	sm.logger.WithField("namespace", namespace).Info("Creating namespace")

	// Create namespace with labels
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name: namespace,
			Labels: map[string]string{
				"cks.io/session": "true",
			},
		},
	}

	_, err := sm.clientset.CoreV1().Namespaces().Create(ctx, ns, metav1.CreateOptions{})
	return err
}

func (sm *SessionManager) setupResourceQuotas(ctx context.Context, namespace string) error {
	sm.logger.WithField("namespace", namespace).Info("Setting up resource quotas")

	// Create a resource quota with limits
	quota := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{
			Name: "session-quota",
		},
		Spec: corev1.ResourceQuotaSpec{
			Hard: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("4"),
				corev1.ResourceMemory: resource.MustParse("8Gi"),
				corev1.ResourcePods:   resource.MustParse("10"),
			},
		},
	}

	// Implement retry with backoff
	backoff := wait.Backoff{
		Steps:    5,
		Duration: 1 * time.Second,
		Factor:   2.0,
		Jitter:   0.1,
	}

	var lastErr error
	err := wait.ExponentialBackoff(backoff, func() (bool, error) {
		_, err := sm.clientset.CoreV1().ResourceQuotas(namespace).Create(ctx, quota, metav1.CreateOptions{})
		if err == nil {
			return true, nil // Success
		}

		if errors.IsAlreadyExists(err) {
			sm.logger.WithField("namespace", namespace).Warn("Resource quota already exists")
			return true, nil // Already exists, consider success
		}

		// Check for namespace not found
		if errors.IsNotFound(err) {
			sm.logger.WithField("namespace", namespace).Error("Namespace not found while creating resource quota")
			// This is a terminal error, no need to retry
			return false, err
		}

		// Record the error and retry
		lastErr = err
		sm.logger.WithError(err).WithField("namespace", namespace).Warn("Failed to create resource quota, retrying...")
		return false, nil // Retry
	})

	if err == wait.ErrWaitTimeout {
		return fmt.Errorf("failed to create resource quota after retries: %v", lastErr)
	}

	sm.logger.WithField("namespace", namespace).Info("Resource quota created successfully")
	return err
}

// loadScenario loads a scenario by ID
func (sm *SessionManager) loadScenario(ctx context.Context, scenarioID string) (*models.Scenario, error) {
	// Use scenario manager to load scenario
	// This is a placeholder - in a real implementation, this would use the scenario manager
	return nil, nil
}

func (sm *SessionManager) initializeScenario(ctx context.Context, session *models.Session) error {
	// Load scenario
	scenario, err := sm.scenarioManager.GetScenario(session.ScenarioID)
	if err != nil {
		return fmt.Errorf("failed to load scenario: %w", err)
	}

	// Create scenario initializer
	initializer := scenarios.NewScenarioInitializer(sm.clientset, sm.kubevirtClient, sm.logger)

	// Run initialization
	err = initializer.InitializeScenario(ctx, session, scenario)
	if err != nil {
		return fmt.Errorf("scenario initialization failed: %w", err)
	}

	return nil
}

// cleanupEnvironment cleans up the Kubernetes resources for a session
func (sm *SessionManager) cleanupEnvironment(ctx context.Context, session *models.Session) error {
	sm.logger.WithFields(logrus.Fields{
		"sessionID": session.ID,
		"namespace": session.Namespace,
	}).Info("Cleaning up environment")

	// Delete VMs first to ensure clean shutdown
	err := sm.kubevirtClient.DeleteVMs(ctx, session.Namespace, session.ControlPlaneVM, session.WorkerNodeVM)
	if err != nil {
		sm.logger.WithError(err).WithField("sessionID", session.ID).Error("Failed to delete VMs")
		// Continue with namespace deletion
	}

	// Delete namespace (which will delete all resources in it)
	err = sm.clientset.CoreV1().Namespaces().Delete(ctx, session.Namespace, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("failed to delete namespace: %w", err)
	}

	sm.logger.WithField("sessionID", session.ID).Info("Environment cleaned up successfully")
	return nil
}

// cleanupExpiredSessions periodically checks and cleans up expired sessions
func (sm *SessionManager) cleanupExpiredSessions() {
	ticker := time.NewTicker(time.Duration(sm.config.CleanupIntervalMinutes) * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			sm.logger.Debug("Running session cleanup")

			// Use a context with timeout for cleanup operations
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)

			// Find expired sessions
			expiredSessions := make([]string, 0)

			func() {
				sm.lock.Lock()
				defer sm.lock.Unlock()

				now := time.Now()

				// Find expired sessions
				for id, session := range sm.sessions {
					if now.After(session.ExpirationTime) &&
						session.Status != models.SessionStatusFailed {
						expiredSessions = append(expiredSessions, id)

						// Mark as failed to prevent race conditions
						session.Status = models.SessionStatusFailed
						session.StatusMessage = "Session expired"
					}
				}
			}()

			// Clean up marked sessions outside the lock
			for _, id := range expiredSessions {
				sm.logger.WithField("sessionID", id).Info("Cleaning up expired session")

				// Get session with lock
				var session *models.Session
				func() {
					sm.lock.RLock()
					defer sm.lock.RUnlock()
					session = sm.sessions[id]
				}()

				if session != nil {
					// Clean up resources
					err := sm.cleanupEnvironment(ctx, session)
					if err != nil {
						sm.logger.WithError(err).WithField("sessionID", id).Error("Error cleaning up expired session environment")
					}

					// Now remove from sessions map with proper locking
					sm.lock.Lock()
					delete(sm.sessions, id)
					sm.lock.Unlock()

					sm.logger.WithField("sessionID", id).Info("Expired session removed")
				}
			}

			// Always cancel the context when done
			cancel()

		case <-sm.stopCh:
			return
		}
	}
}

// Stop stops the session manager and releases resources
func (sm *SessionManager) Stop() {
	close(sm.stopCh)
	sm.logger.Info("Session manager stopped")
}

// CheckVMsStatus checks the status of VMs in a session
func (sm *SessionManager) CheckVMsStatus(ctx context.Context, session *models.Session) (string, error) {
	controlPlaneStatus, err := sm.kubevirtClient.GetVMStatus(ctx, session.Namespace, session.ControlPlaneVM)
	if err != nil {
		return "", fmt.Errorf("failed to get control plane VM status: %w", err)
	}

	workerNodeStatus, err := sm.kubevirtClient.GetVMStatus(ctx, session.Namespace, session.WorkerNodeVM)
	if err != nil {
		return "", fmt.Errorf("failed to get worker node VM status: %w", err)
	}

	sm.logger.WithFields(logrus.Fields{
		"sessionID":          session.ID,
		"controlPlaneStatus": controlPlaneStatus,
		"workerNodeStatus":   workerNodeStatus,
	}).Debug("VM status check")

	// Only return "Running" if both VMs are running
	if controlPlaneStatus == "Running" && workerNodeStatus == "Running" {
		return "Running", nil
	}

	// Return the status of the control plane since it's more critical
	return controlPlaneStatus, nil
}

// UpdateSessionStatus updates the status of a session
func (sm *SessionManager) UpdateSessionStatus(sessionID string, status models.SessionStatus, message string) error {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	session, ok := sm.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// Update status
	session.Status = status
	session.StatusMessage = message

	sm.logger.WithFields(logrus.Fields{
		"sessionID": sessionID,
		"status":    status,
		"message":   message,
	}).Info("Session status updated")

	return nil
}
