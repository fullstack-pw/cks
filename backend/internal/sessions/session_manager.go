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

// Update the task initialization section in CreateSession
func (sm *SessionManager) CreateSession(ctx context.Context, scenarioID string) (*models.Session, error) {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	// Check if maximum sessions exceeded
	if len(sm.sessions) >= sm.config.MaxConcurrentSessions {
		return nil, fmt.Errorf("maximum number of concurrent sessions reached")
	}

	// Generate session ID
	sessionID := uuid.New().String()[:8]
	namespace := fmt.Sprintf("user-session-%s", sessionID)

	// Initialize variables
	var tasks []models.TaskStatus
	var scenarioTitle string

	// Load scenario if specified
	if scenarioID != "" {
		scenario, err := sm.loadScenario(ctx, scenarioID)
		if err != nil {
			return nil, fmt.Errorf("failed to load scenario: %w", err)
		}

		// Store scenario title for logging
		scenarioTitle = scenario.Title

		// Initialize task statuses from loaded scenario
		tasks = make([]models.TaskStatus, 0, len(scenario.Tasks))
		for _, task := range scenario.Tasks {
			tasks = append(tasks, models.TaskStatus{
				ID:     task.ID,
				Status: "pending",
			})

			// Add detailed logging for each task
			sm.logger.WithFields(logrus.Fields{
				"sessionID":       sessionID,
				"taskID":          task.ID,
				"taskTitle":       task.Title,
				"validationCount": len(task.Validation),
			}).Debug("Initialized task with validation rules")
		}

		sm.logger.WithFields(logrus.Fields{
			"sessionID":     sessionID,
			"scenarioID":    scenarioID,
			"scenarioTitle": scenarioTitle,
			"taskCount":     len(tasks),
			"tasksDetailed": func() []map[string]interface{} {
				details := make([]map[string]interface{}, len(scenario.Tasks))
				for i, t := range scenario.Tasks {
					details[i] = map[string]interface{}{
						"id":              t.ID,
						"title":           t.Title,
						"validationCount": len(t.Validation),
					}
				}
				return details
			}(),
		}).Info("Initialized session with scenario tasks")

		sm.logger.WithFields(logrus.Fields{
			"sessionID":     sessionID,
			"scenarioID":    scenarioID,
			"scenarioTitle": scenarioTitle,
			"taskCount":     len(tasks),
		}).Info("Initialized session with scenario tasks")
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
		"sessionID":     sessionID,
		"namespace":     namespace,
		"scenarioID":    scenarioID,
		"scenarioTitle": scenarioTitle,
	}).Info("Creating new session")

	// Create namespace asynchronously with a new background context
	go func() {
		provisionCtx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()

		err := sm.provisionEnvironment(provisionCtx, session)
		if err != nil {
			sm.logger.WithError(err).WithField("sessionID", sessionID).Error("Failed to provision environment")
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

// Update ValidateTask method
func (sm *SessionManager) ValidateTask(ctx context.Context, sessionID, taskID string) (*models.ValidationResponse, error) {
	// Get session
	session, err := sm.GetSession(sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}

	// Check if session has a scenario
	if session.ScenarioID == "" {
		return nil, fmt.Errorf("session has no associated scenario")
	}

	sm.logger.WithFields(logrus.Fields{
		"sessionID":  sessionID,
		"taskID":     taskID,
		"scenarioID": session.ScenarioID,
	}).Debug("Starting task validation")

	// Load scenario to get task validation rules
	scenario, err := sm.loadScenario(ctx, session.ScenarioID)
	if err != nil {
		return nil, fmt.Errorf("failed to load scenario: %w", err)
	}

	sm.logger.WithFields(logrus.Fields{
		"scenarioID": scenario.ID,
		"taskCount":  len(scenario.Tasks),
		"tasks": func() []map[string]interface{} {
			taskInfo := make([]map[string]interface{}, len(scenario.Tasks))
			for i, t := range scenario.Tasks {
				taskInfo[i] = map[string]interface{}{
					"id":              t.ID,
					"title":           t.Title,
					"validationCount": len(t.Validation),
				}
			}
			return taskInfo
		}(),
	}).Debug("Loaded scenario for validation with task details")

	// Find task in scenario
	var taskToValidate *models.Task
	for i, task := range scenario.Tasks {
		sm.logger.WithFields(logrus.Fields{
			"checkingTaskID":  task.ID,
			"targetTaskID":    taskID,
			"taskTitle":       task.Title,
			"validationCount": len(task.Validation),
			"match":           task.ID == taskID,
		}).Debug("Checking task match")

		if task.ID == taskID {
			taskToValidate = &scenario.Tasks[i]
			sm.logger.WithFields(logrus.Fields{
				"taskID":    taskID,
				"foundTask": true,
				"validationRules": func() []map[string]interface{} {
					rules := make([]map[string]interface{}, len(task.Validation))
					for j, rule := range task.Validation {
						rules[j] = map[string]interface{}{
							"id":   rule.ID,
							"type": rule.Type,
						}
					}
					return rules
				}(),
			}).Debug("Found task with validation rules")
			break
		}
	}

	if taskToValidate == nil {
		sm.logger.WithFields(logrus.Fields{
			"sessionID":  sessionID,
			"taskID":     taskID,
			"scenarioID": session.ScenarioID,
			"availableTasks": func() []string {
				ids := make([]string, len(scenario.Tasks))
				for i, t := range scenario.Tasks {
					ids[i] = t.ID
				}
				return ids
			}(),
		}).Error("Task not found in scenario")

		return nil, fmt.Errorf("task %s not found in scenario %s", taskID, session.ScenarioID)
	}

	sm.logger.WithFields(logrus.Fields{
		"taskID":          taskID,
		"taskTitle":       taskToValidate.Title,
		"validationRules": len(taskToValidate.Validation),
	}).Info("Found task for validation")

	// Check if task has validation rules
	if len(taskToValidate.Validation) == 0 {
		sm.logger.WithFields(logrus.Fields{
			"sessionID":  sessionID,
			"taskID":     taskID,
			"scenarioID": session.ScenarioID,
		}).Warn("Task has no validation rules")

		// Return success if no validation rules
		return &models.ValidationResponse{
			Success: true,
			Message: "No validation rules defined for this task",
			Details: []models.ValidationDetail{},
		}, nil
	}

	// Log each validation rule
	for i, rule := range taskToValidate.Validation {
		sm.logger.WithFields(logrus.Fields{
			"taskID":    taskID,
			"ruleIndex": i,
			"ruleID":    rule.ID,
			"ruleType":  rule.Type,
		}).Debug("Validating rule")
	}

	// Validate task using the validation engine
	result, err := sm.validationEngine.ValidateTask(ctx, session, *taskToValidate)
	if err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Update task status based on validation result
	status := "failed"
	if result.Success {
		status = "completed"
	}

	// Store validation result in session - NEW FUNCTIONALITY
	err = sm.UpdateTaskValidationResult(sessionID, taskID, status, result)
	if err != nil {
		sm.logger.WithError(err).WithFields(logrus.Fields{
			"sessionID": sessionID,
			"taskID":    taskID,
			"status":    status,
		}).Error("Failed to update task validation result")
		// Continue despite error - validation result is more important
	}

	sm.logger.WithFields(logrus.Fields{
		"sessionID": sessionID,
		"taskID":    taskID,
		"success":   result.Success,
		"status":    status,
		"details":   len(result.Details),
	}).Info("Task validation completed")

	return result, nil
}

// NEW METHOD: Store validation results in session
func (sm *SessionManager) UpdateTaskValidationResult(sessionID, taskID string, status string, validationResult *models.ValidationResponse) error {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	session, ok := sm.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// Find task and update status and validation result
	found := false
	for i, task := range session.Tasks {
		if task.ID == taskID {
			session.Tasks[i].Status = status
			session.Tasks[i].ValidationTime = time.Now()
			session.Tasks[i].ValidationResult = &models.ValidationResult{
				Success:   validationResult.Success,
				Message:   validationResult.Message,
				Details:   validationResult.Details,
				Timestamp: time.Now(),
			}
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
			ValidationResult: &models.ValidationResult{
				Success:   validationResult.Success,
				Message:   validationResult.Message,
				Details:   validationResult.Details,
				Timestamp: time.Now(),
			},
		})
	}

	sm.logger.WithFields(logrus.Fields{
		"sessionID": sessionID,
		"taskID":    taskID,
		"status":    status,
		"success":   validationResult.Success,
	}).Info("Task validation result stored in session")

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

// provisionEnvironment provisions a Kubernetes environment for a session
func (sm *SessionManager) provisionEnvironment(ctx context.Context, session *models.Session) error {
	// Update session status with proper locking
	if err := sm.UpdateSessionStatus(session.ID, models.SessionStatusProvisioning, ""); err != nil {
		return fmt.Errorf("failed to update session status: %w", err)
	}

	sm.logger.WithField("sessionID", session.ID).Info("Provisioning environment")

	// Determine which provisioning strategy to use
	strategy := sm.determineProvisioningStrategy(ctx)

	// Use the appropriate provisioning method based on the strategy
	switch strategy {
	case models.StrategySnapshot:
		return sm.provisionFromSnapshot(ctx, session)
	case models.StrategyBootstrap:
		return sm.provisionFromBootstrap(ctx, session)
	default:
		return fmt.Errorf("unknown provisioning strategy")
	}
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
	return sm.scenarioManager.GetScenario(scenarioID)
}

// Update initializeScenario method
func (sm *SessionManager) initializeScenario(ctx context.Context, session *models.Session) error {
	if session.ScenarioID == "" {
		return fmt.Errorf("session has no scenario ID")
	}

	// Load scenario
	scenario, err := sm.scenarioManager.GetScenario(session.ScenarioID)
	if err != nil {
		return fmt.Errorf("failed to load scenario: %w", err)
	}

	sm.logger.WithFields(logrus.Fields{
		"sessionID":     session.ID,
		"scenarioID":    scenario.ID,
		"scenarioTitle": scenario.Title,
		"setupSteps":    len(scenario.SetupSteps),
	}).Info("Initializing scenario for session")

	// Check if scenario has setup steps
	if len(scenario.SetupSteps) == 0 {
		sm.logger.WithField("scenarioID", scenario.ID).Debug("No setup steps for scenario")
		return nil
	}

	// Create scenario initializer
	initializer := scenarios.NewScenarioInitializer(sm.clientset, sm.kubevirtClient, sm.logger)

	// Run initialization with timeout
	initCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	err = initializer.InitializeScenario(initCtx, session, scenario)
	if err != nil {
		return fmt.Errorf("scenario initialization failed: %w", err)
	}

	sm.logger.WithFields(logrus.Fields{
		"sessionID":  session.ID,
		"scenarioID": scenario.ID,
	}).Info("Scenario initialization completed")

	return nil
}

func (sm *SessionManager) GetSessionWithScenario(ctx context.Context, sessionID string) (*models.Session, *models.Scenario, error) {
	session, err := sm.GetSession(sessionID)
	if err != nil {
		return nil, nil, err
	}

	if session.ScenarioID == "" {
		return session, nil, nil
	}

	scenario, err := sm.loadScenario(ctx, session.ScenarioID)
	if err != nil {
		sm.logger.WithError(err).WithField("scenarioID", session.ScenarioID).Warn("Failed to load scenario for session")
		return session, nil, nil // Return session even if scenario fails to load
	}

	return session, scenario, nil
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

func (sm *SessionManager) GetOrCreateTerminalSession(sessionID, target string) (string, bool, error) {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	session, ok := sm.sessions[sessionID]
	if !ok {
		return "", false, fmt.Errorf("session not found: %s", sessionID)
	}

	// Initialize ActiveTerminals if nil
	if session.ActiveTerminals == nil {
		session.ActiveTerminals = make(map[string]models.TerminalInfo) // Use models.TerminalInfo
	}

	// Look for existing active terminal for this target
	for terminalID, terminalInfo := range session.ActiveTerminals {
		if terminalInfo.Target == target && terminalInfo.Status == "active" {
			// Update last used time
			terminalInfo.LastUsedAt = time.Now()
			session.ActiveTerminals[terminalID] = terminalInfo

			sm.logger.WithFields(logrus.Fields{
				"sessionID":  sessionID,
				"terminalID": terminalID,
				"target":     target,
			}).Info("Reusing existing terminal session")

			return terminalID, true, nil // true = existing terminal
		}
	}

	// No existing terminal found, will need to create new one
	return "", false, nil // false = needs new terminal
}

// StoreTerminalSession stores terminal info in session
func (sm *SessionManager) StoreTerminalSession(sessionID, terminalID, target string) error {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	session, ok := sm.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// Initialize ActiveTerminals if nil
	if session.ActiveTerminals == nil {
		session.ActiveTerminals = make(map[string]models.TerminalInfo) // Use models.TerminalInfo
	}

	// Store terminal info
	session.ActiveTerminals[terminalID] = models.TerminalInfo{ // Use models.TerminalInfo
		ID:         terminalID,
		Target:     target,
		Status:     "active",
		CreatedAt:  time.Now(),
		LastUsedAt: time.Now(),
	}

	// Also maintain existing TerminalSessions map for backward compatibility
	if session.TerminalSessions == nil {
		session.TerminalSessions = make(map[string]string)
	}
	session.TerminalSessions[terminalID] = target

	sm.logger.WithFields(logrus.Fields{
		"sessionID":  sessionID,
		"terminalID": terminalID,
		"target":     target,
	}).Info("Stored terminal session info")

	return nil
}

// MarkTerminalInactive marks a terminal as inactive
func (sm *SessionManager) MarkTerminalInactive(sessionID, terminalID string) error {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	session, ok := sm.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	if session.ActiveTerminals != nil {
		if terminalInfo, exists := session.ActiveTerminals[terminalID]; exists {
			terminalInfo.Status = "disconnected"
			terminalInfo.LastUsedAt = time.Now()
			session.ActiveTerminals[terminalID] = terminalInfo
		}
	}

	return nil
}

// determineProvisioningStrategy decides whether to use snapshot or bootstrap provisioning
func (sm *SessionManager) determineProvisioningStrategy(ctx context.Context) models.ProvisioningStrategy {
	if sm.snapshotsExist(ctx) {
		sm.logger.Info("Snapshots exist, using snapshot provisioning strategy")
		return models.StrategySnapshot
	}
	sm.logger.Info("Snapshots don't exist, using bootstrap provisioning strategy")
	return models.StrategyBootstrap
}

// snapshotsExist checks if required snapshots exist and are ready to use
func (sm *SessionManager) snapshotsExist(ctx context.Context) bool {
	// Check if both snapshots exist and are ready
	controlPlaneExists := sm.checkSnapshotExists(ctx, "cks-control-plane-base-snapshot")
	workerExists := sm.checkSnapshotExists(ctx, "cks-worker-base-snapshot")

	sm.logger.WithFields(logrus.Fields{
		"controlPlaneSnapshotExists": controlPlaneExists,
		"workerSnapshotExists":       workerExists,
	}).Debug("Snapshot existence check")

	return controlPlaneExists && workerExists
}

// checkSnapshotExists checks if a specific snapshot exists
func (sm *SessionManager) checkSnapshotExists(ctx context.Context, snapshotName string) bool {
	// TODO: Implement actual snapshot check in Phase 3
	// For now, always return false to use bootstrap strategy
	sm.logger.WithField("snapshotName", snapshotName).Debug("Checking snapshot existence (placeholder)")
	return false
}

// provisionFromBootstrap provisions an environment using the traditional bootstrap process
func (sm *SessionManager) provisionFromBootstrap(ctx context.Context, session *models.Session) error {
	sm.logger.WithField("sessionID", session.ID).Info("Provisioning environment using bootstrap method")

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

// provisionFromSnapshot provisions an environment using KubeVirt snapshots
func (sm *SessionManager) provisionFromSnapshot(ctx context.Context, session *models.Session) error {
	sm.logger.WithField("sessionID", session.ID).Info("Snapshot provisioning not yet implemented, falling back to bootstrap")

	// In Phase 4, this will be implemented to create VMs from snapshots
	// For now, fall back to bootstrap provisioning
	return sm.provisionFromBootstrap(ctx, session)
}
