// internal/controllers/session_controller.go - HTTP handlers for session management

package controllers

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/fullstack-pw/cks/backend/internal/models"
	"github.com/fullstack-pw/cks/backend/internal/sessions"
	"github.com/gin-gonic/gin"
)

// SessionController handles HTTP requests related to sessions
type SessionController struct {
	sessionManager *sessions.SessionManager
}

// NewSessionController creates a new session controller
func NewSessionController(sessionManager *sessions.SessionManager) *SessionController {
	return &SessionController{
		sessionManager: sessionManager,
	}
}

// Update the RegisterRoutes method in session_controller.go
func (sc *SessionController) RegisterRoutes(router *gin.Engine) {
	sessions := router.Group("/api/v1/sessions")
	{
		sessions.POST("", sc.CreateSession)
		sessions.GET("", sc.ListSessions)
		sessions.GET("/:id", sc.GetSession)
		sessions.DELETE("/:id", sc.DeleteSession)
		sessions.PUT("/:id/extend", sc.ExtendSession)
		// Remove this line since it's registered by TerminalController
		// sessions.POST("/:id/terminals", sc.CreateTerminal)
		sessions.GET("/:id/tasks", sc.ListTasks)
		sessions.POST("/:id/tasks/:taskId/validate", sc.ValidateTask)
	}

	// Remove these terminal routes entirely since they're now handled by TerminalController
	// terminals := router.Group("/api/v1/terminals")
	// {
	//     terminals.GET("/:id/attach", sc.AttachTerminal)
	//     terminals.POST("/:id/resize", sc.ResizeTerminal)
	//     terminals.DELETE("/:id", sc.CloseTerminal)
	// }
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

// CreateTerminal creates a new terminal session
func (sc *SessionController) CreateTerminal(c *gin.Context) {
	sessionID := c.Param("id")

	var request models.CreateTerminalRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	// Check if session exists
	_, err := sc.sessionManager.GetSession(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("Session not found: %v", err)})
		return
	}

	// Create terminal session
	terminalID, err := sc.createTerminalSession(sessionID, request.Target)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to create terminal: %v", err)})
		return
	}

	// Register terminal session with session manager
	err = sc.sessionManager.RegisterTerminalSession(sessionID, terminalID, request.Target)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to register terminal: %v", err)})
		return
	}

	c.JSON(http.StatusCreated, models.CreateTerminalResponse{
		TerminalID: terminalID,
	})
}

// AttachTerminal handles WebSocket connection to a terminal
func (sc *SessionController) AttachTerminal(c *gin.Context) {
	terminalID := c.Param("id")
	print(terminalID)
	// In a real implementation, this would handle WebSocket upgrade and proxying
	// For simplicity, the logic is omitted here
	c.JSON(http.StatusNotImplemented, gin.H{"error": "WebSocket terminal attachment not implemented in this example"})
}

// ResizeTerminal handles terminal resize events
func (sc *SessionController) ResizeTerminal(c *gin.Context) {
	terminalID := c.Param("id")

	var request models.ResizeTerminalRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid resize request"})
		return
	}

	// In a real implementation, this would resize the PTY in the pod
	// For simplicity, the logic is omitted here
	fmt.Printf("Resizing terminal %s to %dx%d\n", terminalID, request.Cols, request.Rows)

	c.JSON(http.StatusOK, gin.H{"message": "Terminal resized"})
}

// CloseTerminal closes a terminal session
func (sc *SessionController) CloseTerminal(c *gin.Context) {
	terminalID := c.Param("id")

	// In a real implementation, this would close the terminal session
	// For simplicity, the logic is omitted here
	fmt.Printf("Closing terminal %s\n", terminalID)

	c.JSON(http.StatusOK, gin.H{"message": "Terminal closed"})
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
	session, err := sc.sessionManager.GetSession(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("Session not found: %v", err)})
		return
	}

	// In a real implementation, this would validate the task
	// For this example, we'll simulate validation
	validationResults, err := sc.validateTask(session, taskID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Validation failed: %v", err)})
		return
	}

	// Update task status based on validation results
	status := "completed"
	if !validationResults.Success {
		status = "failed"
	}

	err = sc.sessionManager.UpdateTaskStatus(sessionID, taskID, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to update task status: %v", err)})
		return
	}

	c.JSON(http.StatusOK, validationResults)
}

// Helper methods

// createTerminalSession creates a new terminal session for a VM
func (sc *SessionController) createTerminalSession(sessionID, target string) (string, error) {
	// In a real implementation, this would create a terminal session in a pod
	// For simplicity, we'll just generate a terminal ID
	return fmt.Sprintf("%s-%s-%d", sessionID, target, time.Now().Unix()), nil
}

// validateTask validates a task in a session
func (sc *SessionController) validateTask(session *models.Session, taskID string) (*models.ValidationResponse, error) {
	// In a real implementation, this would run validation rules for the task
	// For this example, we'll simulate a successful validation
	return &models.ValidationResponse{
		Success: true,
		Message: "Task completed successfully!",
		Details: []models.ValidationDetail{
			{
				Rule:    "Resource existence check",
				Passed:  true,
				Message: "Required resources exist",
			},
			{
				Rule:    "Configuration check",
				Passed:  true,
				Message: "Configuration is correct",
			},
		},
	}, nil
}
