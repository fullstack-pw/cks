// backend/internal/controllers/terminal_controller.go - Terminal API controller

package controllers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	"github.com/fullstack-pw/cks/backend/internal/models"
	"github.com/fullstack-pw/cks/backend/internal/sessions"
	"github.com/fullstack-pw/cks/backend/internal/terminal"
)

// TerminalController handles HTTP requests related to terminal sessions
type TerminalController struct {
	terminalManager *terminal.Manager
	sessionManager  *sessions.SessionManager
	logger          *logrus.Logger
}

// NewTerminalController creates a new terminal controller
func NewTerminalController(terminalManager *terminal.Manager, sessionManager *sessions.SessionManager, logger *logrus.Logger) *TerminalController {
	return &TerminalController{
		terminalManager: terminalManager,
		sessionManager:  sessionManager,
		logger:          logger,
	}
}

// RegisterRoutes registers the terminal controller routes
func (tc *TerminalController) RegisterRoutes(router *gin.Engine) {
	// Terminal routes
	terminals := router.Group("/api/v1/terminals")
	{
		terminals.GET("/:id/attach", tc.AttachTerminal)
		terminals.POST("/:id/resize", tc.ResizeTerminal)
		terminals.DELETE("/:id", tc.CloseTerminal)
	}
}

// CreateTerminal creates a new terminal session
func (tc *TerminalController) CreateTerminal(c *gin.Context) {
	sessionID := c.Param("id")

	var request models.CreateTerminalRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		tc.logger.WithError(err).Error("Invalid terminal creation request")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	// Check if session exists
	session, err := tc.sessionManager.GetSession(sessionID)
	if err != nil {
		tc.logger.WithError(err).WithField("sessionID", sessionID).Error("Session not found")
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("Session not found: %v", err)})
		return
	}

	// Validate target
	targetVM := ""
	switch request.Target {
	case "control-plane":
		targetVM = session.ControlPlaneVM
	case "worker-node":
		targetVM = session.WorkerNodeVM
	default:
		tc.logger.WithField("target", request.Target).Error("Invalid terminal target")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid terminal target"})
		return
	}

	// Create terminal session
	terminalID, err := tc.terminalManager.CreateSession(sessionID, session.Namespace, targetVM)
	if err != nil {
		tc.logger.WithError(err).Error("Failed to create terminal session")
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to create terminal: %v", err)})
		return
	}

	// Register terminal with session manager
	err = tc.sessionManager.RegisterTerminalSession(sessionID, terminalID, request.Target)
	if err != nil {
		tc.logger.WithError(err).Error("Failed to register terminal session")
		// Try to close the terminal session we just created
		_ = tc.terminalManager.CloseSession(terminalID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to register terminal: %v", err)})
		return
	}

	tc.logger.WithFields(logrus.Fields{
		"sessionID":  sessionID,
		"terminalID": terminalID,
		"target":     request.Target,
	}).Info("Terminal session created")

	c.JSON(http.StatusCreated, models.CreateTerminalResponse{
		TerminalID: terminalID,
	})
}

// AttachTerminal handles WebSocket connection to a terminal
func (tc *TerminalController) AttachTerminal(c *gin.Context) {
	terminalID := c.Param("id")

	tc.logger.WithField("terminalID", terminalID).Info("Attaching to terminal session")

	// Handle WebSocket
	tc.terminalManager.HandleTerminal(c.Writer, c.Request, terminalID)
}

// ResizeTerminal handles terminal resize events
func (tc *TerminalController) ResizeTerminal(c *gin.Context) {
	terminalID := c.Param("id")

	var request models.ResizeTerminalRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		tc.logger.WithError(err).Error("Invalid resize request")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid resize request"})
		return
	}

	// Validate dimensions
	if request.Rows == 0 || request.Cols == 0 {
		tc.logger.WithFields(logrus.Fields{
			"terminalID": terminalID,
			"rows":       request.Rows,
			"cols":       request.Cols,
		}).Error("Invalid terminal dimensions")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid terminal dimensions"})
		return
	}

	// Resize terminal
	err := tc.terminalManager.ResizeTerminal(terminalID, request.Rows, request.Cols)
	if err != nil {
		tc.logger.WithError(err).WithField("terminalID", terminalID).Error("Failed to resize terminal")
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to resize terminal: %v", err)})
		return
	}

	tc.logger.WithFields(logrus.Fields{
		"terminalID": terminalID,
		"rows":       request.Rows,
		"cols":       request.Cols,
	}).Debug("Terminal resized")

	c.JSON(http.StatusOK, gin.H{"message": "Terminal resized"})
}

// CloseTerminal closes a terminal session
func (tc *TerminalController) CloseTerminal(c *gin.Context) {
	terminalID := c.Param("id")

	// Close terminal session
	err := tc.terminalManager.CloseSession(terminalID)
	if err != nil {
		tc.logger.WithError(err).WithField("terminalID", terminalID).Error("Failed to close terminal")
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to close terminal: %v", err)})
		return
	}

	// Unregister terminal session from all sessions
	// (We don't know which session it belongs to, so find it)
	sessions := tc.sessionManager.ListSessions()
	for _, session := range sessions {
		for id := range session.TerminalSessions {
			if id == terminalID {
				_ = tc.sessionManager.UnregisterTerminalSession(session.ID, terminalID)
				break
			}
		}
	}

	tc.logger.WithField("terminalID", terminalID).Info("Terminal session closed")
	c.JSON(http.StatusOK, gin.H{"message": "Terminal closed"})
}
