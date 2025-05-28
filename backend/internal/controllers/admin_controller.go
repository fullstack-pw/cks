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
		admin.POST("/bootstrap-pool", ac.BootstrapClusterPool)
	}
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
