// backend/internal/controllers/session_controller.go

package controllers

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/fullstack-pw/cks/backend/internal/models"
	"github.com/fullstack-pw/cks/backend/internal/sessions"
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

// SessionController handles HTTP requests related to sessions
type SessionController struct {
	sessionManager *sessions.SessionManager
	logger         *logrus.Logger
}

// NewSessionController creates a new session controller
func NewSessionController(sessionManager *sessions.SessionManager, logger *logrus.Logger) *SessionController {
	return &SessionController{
		sessionManager: sessionManager,
		logger:         logger,
	}
}

// RegisterRoutes registers the session controller routes
func (sc *SessionController) RegisterRoutes(router *gin.Engine) {
	sessions := router.Group("/api/v1/sessions")
	{
		sessions.POST("", sc.CreateSession)
		sessions.GET("", sc.ListSessions)
		sessions.GET("/:id", sc.GetSession)
		sessions.DELETE("/:id", sc.DeleteSession)
		sessions.PUT("/:id/extend", sc.ExtendSession)
		sessions.GET("/:id/tasks", sc.ListTasks)
		sessions.POST("/:id/tasks/:taskId/validate", sc.ValidateTask)
	}
}

// CreateSession handles the creation of a new session
func (sc *SessionController) CreateSession(c *gin.Context) {
	var request models.CreateSessionRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	// Create a timeout context
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	// Create session
	session, err := sc.sessionManager.CreateSession(ctx, request.ScenarioID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to create session: %v", err)})
		return
	}

	c.JSON(http.StatusCreated, models.CreateSessionResponse{
		SessionID: session.ID,
		Status:    string(session.Status),
	})
}

// ListSessions returns a list of all active sessions
func (sc *SessionController) ListSessions(c *gin.Context) {
	sessions := sc.sessionManager.ListSessions()
	c.JSON(http.StatusOK, sessions)
}

// GetSession returns details for a specific session
func (sc *SessionController) GetSession(c *gin.Context) {
	sessionID := c.Param("id")

	session, err := sc.sessionManager.GetSession(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("Session not found: %v", err)})
		return
	}

	// Add additional status check for VM readiness
	if session.Status == models.SessionStatusProvisioning {
		// Check VMs status
		vmStatus, err := sc.sessionManager.CheckVMsStatus(c.Request.Context(), session)
		if err != nil {
			// Just log the error, don't fail the request
			sc.logger.WithError(err).WithField("sessionID", sessionID).Warn("Failed to check VM status")
		} else if vmStatus == "Running" {
			// Update session status to running if VMs are ready
			sc.sessionManager.UpdateSessionStatus(sessionID, models.SessionStatusRunning, "")
			session.Status = models.SessionStatusRunning
		}
	}

	c.JSON(http.StatusOK, session)
}

// DeleteSession deletes a session and its resources
func (sc *SessionController) DeleteSession(c *gin.Context) {
	sessionID := c.Param("id")

	// Create a timeout context
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	err := sc.sessionManager.DeleteSession(ctx, sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to delete session: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Session deleted successfully"})
}

// ExtendSession extends the expiration time of a session
func (sc *SessionController) ExtendSession(c *gin.Context) {
	sessionID := c.Param("id")

	// Default extension is 30 minutes
	extension := 30 * time.Minute

	// Check for custom extension time
	type ExtendRequest struct {
		Minutes int `json:"minutes"`
	}

	var request ExtendRequest
	if c.ShouldBindJSON(&request) == nil && request.Minutes > 0 {
		extension = time.Duration(request.Minutes) * time.Minute
	}

	err := sc.sessionManager.ExtendSession(sessionID, extension)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to extend session: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Session extended successfully"})
}

// ListTasks lists the tasks for a session
func (sc *SessionController) ListTasks(c *gin.Context) {
	sessionID := c.Param("id")

	// Get session to access its tasks
	session, err := sc.sessionManager.GetSession(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("Session not found: %v", err)})
		return
	}

	c.JSON(http.StatusOK, session.Tasks)
}

// ValidateTask validates a specific task in a session
func (sc *SessionController) ValidateTask(c *gin.Context) {
	sessionID := c.Param("id")
	taskID := c.Param("taskId")

	// Get session
	_, err := sc.sessionManager.GetSession(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("Session not found: %v", err)})
		return
	}

	// Use session context for validation
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	// Validate the task
	validationResults, err := sc.sessionManager.ValidateTask(ctx, sessionID, taskID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Validation failed: %v", err)})
		return
	}

	c.JSON(http.StatusOK, validationResults)
}
