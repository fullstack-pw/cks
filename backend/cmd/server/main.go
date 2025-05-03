// cmd/server/main.go - Main application entry point

package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/fullstack-pw/cks/backend/internal/config"
	"github.com/fullstack-pw/cks/backend/internal/controllers"
	"github.com/fullstack-pw/cks/backend/internal/middleware"
	"github.com/fullstack-pw/cks/backend/internal/scenarios"
	"github.com/fullstack-pw/cks/backend/internal/sessions"
)

func main() {
	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Set up Gin
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.Default()

	// Configure middleware
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{cfg.CorsAllowOrigin},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))
	router.Use(middleware.RequestID())
	router.Use(middleware.Logger())

	// Health check and metrics
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	router.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// Create session manager
	sessionManager, err := sessions.NewSessionManager(cfg)
	if err != nil {
		log.Fatalf("Failed to create session manager: %v", err)
	}
	defer sessionManager.Stop()

	// Create scenario manager
	scenarioManager, err := scenarios.NewScenarioManager(cfg.ScenariosPath)
	if err != nil {
		log.Fatalf("Failed to create scenario manager: %v", err)
	}

	// Register controllers
	sessionController := controllers.NewSessionController(sessionManager)
	sessionController.RegisterRoutes(router)

	scenarioController := controllers.NewScenarioController(scenarioManager)
	scenarioController.RegisterRoutes(router)

	// Create HTTP server
	server := &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.ServerHost, cfg.ServerPort),
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Run server in a goroutine
	go func() {
		log.Printf("Starting server on %s:%d", cfg.ServerHost, cfg.ServerPort)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shut down the server
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	// Create context with timeout for shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Shutdown server
	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited properly")
}
