// internal/controllers/scenario_controller.go - HTTP handlers for scenario management

package controllers

import (
	"net/http"

	"github.com/fullstack-pw/cks/backend/internal/scenarios"
	"github.com/gin-gonic/gin"
)

// ScenarioController handles HTTP requests related to scenarios
type ScenarioController struct {
	scenarioManager *scenarios.ScenarioManager
}

// NewScenarioController creates a new scenario controller
func NewScenarioController(scenarioManager *scenarios.ScenarioManager) *ScenarioController {
	return &ScenarioController{
		scenarioManager: scenarioManager,
	}
}

// RegisterRoutes registers the scenario controller routes
func (sc *ScenarioController) RegisterRoutes(router *gin.Engine) {
	scenarios := router.Group("/api/v1/scenarios")
	{
		scenarios.GET("", sc.ListScenarios)
		scenarios.GET("/:id", sc.GetScenario)
		scenarios.GET("/categories", sc.ListCategories)
	}
}

// ListScenarios returns a list of all available scenarios
func (sc *ScenarioController) ListScenarios(c *gin.Context) {
	// Get query parameters for filtering
	category := c.Query("category")
	difficulty := c.Query("difficulty")
	searchQuery := c.Query("search")

	// Get scenarios with filters
	scenarios, err := sc.scenarioManager.ListScenarios(category, difficulty, searchQuery)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, scenarios)
}

// GetScenario returns details for a specific scenario
func (sc *ScenarioController) GetScenario(c *gin.Context) {
	scenarioID := c.Param("id")

	scenario, err := sc.scenarioManager.GetScenario(scenarioID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, scenario)
}

// ListCategories returns all available scenario categories
func (sc *ScenarioController) ListCategories(c *gin.Context) {
	categories, err := sc.scenarioManager.GetCategories()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, categories)
}
