package controllers

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	"github.com/fullstack-pw/cks/backend/internal/sessions"
)

// AdminController handles administrative operations
type AdminController struct {
	sessionManager *sessions.SessionManager
	logger         *logrus.Logger
}

// NewAdminController creates a new admin controller
func NewAdminController(sessionManager *sessions.SessionManager, logger *logrus.Logger) *AdminController {
	return &AdminController{
		sessionManager: sessionManager,
		logger:         logger,
	}
}

// RegisterRoutes registers the admin controller routes
func (ac *AdminController) RegisterRoutes(router *gin.Engine) {
	admin := router.Group("/api/v1/admin")
	{
		admin.POST("/snapshots/create", ac.CreateBaseSnapshot)
		admin.GET("/snapshots/status", ac.GetSnapshotStatus)
		admin.DELETE("/snapshots", ac.DeleteSnapshots)
		admin.POST("/snapshots/recreate", ac.RecreateSnapshots)
		admin.POST("/bootstrap-pool", ac.BootstrapClusterPool)
	}
}

// CreateBaseSnapshot creates base cluster snapshots
func (ac *AdminController) CreateBaseSnapshot(c *gin.Context) {
	// Get sessionID from request body
	var request struct {
		SessionID string `json:"sessionId" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		ac.logger.WithError(err).Error("Invalid request for creating snapshots")
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "sessionId is required in request body",
		})
		return
	}

	ac.logger.WithField("sessionID", request.SessionID).Info("Admin request to create base snapshots from session")

	// Create context with timeout
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Minute)
	defer cancel()

	// Create snapshots from the specified session
	err := ac.sessionManager.CreateBaseClusterSnapshot(ctx, request.SessionID)
	if err != nil {
		ac.logger.WithError(err).Error("Failed to create base snapshots")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to create base snapshots",
			"details": err.Error(),
		})
		return
	}

	ac.logger.WithField("sessionID", request.SessionID).Info("Base snapshots created successfully")
	c.JSON(http.StatusOK, gin.H{
		"message":   "Base snapshots created successfully from session",
		"sessionId": request.SessionID,
		"status":    "completed",
	})
}

// GetSnapshotStatus returns the current status of snapshots
func (ac *AdminController) GetSnapshotStatus(c *gin.Context) {
	ctx := c.Request.Context()

	// Get snapshot information
	controlPlaneInfo := ac.sessionManager.GetSnapshotInfo(ctx, "vm-templates", "cks-control-plane-base-snapshot")
	workerInfo := ac.sessionManager.GetSnapshotInfo(ctx, "vm-templates", "cks-worker-base-snapshot")

	// Determine current provisioning strategy
	strategy := "bootstrap"
	if controlPlaneInfo["ready"].(bool) && workerInfo["ready"].(bool) {
		strategy = "snapshot"
	}

	status := map[string]interface{}{
		"snapshots": map[string]interface{}{
			"controlPlane": controlPlaneInfo,
			"worker":       workerInfo,
		},
		"strategy": strategy,
		"ready":    strategy == "snapshot",
	}

	c.JSON(http.StatusOK, status)
}

// DeleteSnapshots deletes all base snapshots
func (ac *AdminController) DeleteSnapshots(c *gin.Context) {
	ac.logger.Info("Admin request to delete base snapshots")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Minute)
	defer cancel()

	err := ac.sessionManager.DeleteBaseSnapshots(ctx)
	if err != nil {
		ac.logger.WithError(err).Error("Failed to delete base snapshots")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to delete base snapshots",
			"details": err.Error(),
		})
		return
	}

	ac.logger.Info("Base snapshots deleted successfully")
	c.JSON(http.StatusOK, gin.H{
		"message": "Base snapshots deleted successfully",
		"status":  "deleted",
	})
}

// RecreateSnapshots deletes existing snapshots and creates new ones
func (ac *AdminController) RecreateSnapshots(c *gin.Context) {
	// Get sessionID from request body
	var request struct {
		SessionID string `json:"sessionId" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		ac.logger.WithError(err).Error("Invalid request for recreating snapshots")
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "sessionId is required in request body",
		})
		return
	}

	ac.logger.WithField("sessionID", request.SessionID).Info("Admin request to recreate base snapshots")

	// Create context with longer timeout for recreation
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Minute)
	defer cancel()

	// Delete existing snapshots first
	err := ac.sessionManager.DeleteBaseSnapshots(ctx)
	if err != nil {
		ac.logger.WithError(err).Error("Failed to delete existing snapshots during recreation")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to delete existing snapshots",
			"details": err.Error(),
		})
		return
	}

	// Wait a bit for cleanup to complete
	time.Sleep(30 * time.Second)

	// Create new snapshots from the specified session
	err = ac.sessionManager.CreateBaseClusterSnapshot(ctx, request.SessionID)
	if err != nil {
		ac.logger.WithError(err).Error("Failed to create new snapshots during recreation")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to create new snapshots",
			"details": err.Error(),
		})
		return
	}

	ac.logger.WithField("sessionID", request.SessionID).Info("Base snapshots recreated successfully")
	c.JSON(http.StatusOK, gin.H{
		"message":   "Base snapshots recreated successfully",
		"sessionId": request.SessionID,
		"status":    "completed",
	})
}

// BootstrapClusterPool bootstraps all 3 baseline clusters
func (ac *AdminController) BootstrapClusterPool(c *gin.Context) {
	ac.logger.Info("Admin request to bootstrap cluster pool")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Minute)
	defer cancel()

	err := ac.sessionManager.BootstrapClusterPool(ctx)
	if err != nil {
		ac.logger.WithError(err).Error("Failed to bootstrap cluster pool")
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to bootstrap cluster pool",
			"details": err.Error(),
		})
		return
	}

	ac.logger.Info("Cluster pool bootstrap completed successfully")
	c.JSON(http.StatusOK, gin.H{
		"message":  "Cluster pool bootstrapped successfully",
		"clusters": []string{"cluster1", "cluster2", "cluster3"},
		"status":   "completed",
	})
}
