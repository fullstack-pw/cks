// backend/internal/clusterpool/manager.go
package clusterpool

import (
	"fmt"
	"sync"
	"time"

	"github.com/fullstack-pw/cks/backend/internal/config"
	"github.com/fullstack-pw/cks/backend/internal/kubevirt"
	"github.com/fullstack-pw/cks/backend/internal/models"
	"github.com/sirupsen/logrus"
	"k8s.io/client-go/kubernetes"
)

const (
	PoolSize = 3 // cluster1, cluster2, cluster3
)

// Manager manages the cluster pool for session assignment
type Manager struct {
	clusters       map[string]*models.ClusterPool
	lock           sync.RWMutex
	kubeClient     kubernetes.Interface
	kubevirtClient *kubevirt.Client
	config         *config.Config
	logger         *logrus.Logger

	// Background task control
	stopCh chan struct{}
}

// NewManager creates a new cluster pool manager
func NewManager(
	cfg *config.Config,
	kubeClient kubernetes.Interface,
	kubevirtClient *kubevirt.Client,
	logger *logrus.Logger,
) (*Manager, error) {
	manager := &Manager{
		clusters:       make(map[string]*models.ClusterPool, PoolSize),
		kubeClient:     kubeClient,
		kubevirtClient: kubevirtClient,
		config:         cfg,
		logger:         logger,
		stopCh:         make(chan struct{}),
	}

	// Initialize the pool
	manager.initializePool()

	// Start background maintenance
	go manager.maintenanceLoop()

	return manager, nil
}

// initializePool sets up the initial cluster pool state with static VM names
func (m *Manager) initializePool() {
	m.logger.Info("Initializing cluster pool with static VM names...")

	clusterIDs := []string{"cluster1", "cluster2", "cluster3"}

	for _, clusterID := range clusterIDs {
		// Use consistent naming pattern for VMs
		controlPlaneVM := fmt.Sprintf("cks-control-plane-%s", clusterID)
		workerVM := fmt.Sprintf("cks-worker-node-%s", clusterID)

		cluster := &models.ClusterPool{
			ClusterID:       clusterID,
			Namespace:       clusterID,             // namespace matches cluster ID
			Status:          models.StatusCreating, // Will be updated after bootstrap
			ControlPlaneVM:  controlPlaneVM,
			WorkerNodeVM:    workerVM,
			CreatedAt:       time.Now(),
			LastReset:       time.Now(),
			LastHealthCheck: time.Now(),
		}

		m.clusters[clusterID] = cluster

		m.logger.WithFields(logrus.Fields{
			"clusterID":      clusterID,
			"namespace":      cluster.Namespace,
			"controlPlaneVM": cluster.ControlPlaneVM,
			"workerVM":       cluster.WorkerNodeVM,
			"status":         cluster.Status,
		}).Info("Cluster added to pool")
	}

	m.logger.WithField("poolSize", len(m.clusters)).Info("Cluster pool initialized")
}

// AssignCluster assigns an available cluster to a session
func (m *Manager) AssignCluster(sessionID string) (*models.ClusterPool, error) {
	m.lock.Lock()
	defer m.lock.Unlock()

	// Find first available cluster
	for clusterID, cluster := range m.clusters {
		if cluster.Status == models.StatusAvailable {
			// Lock cluster to session
			cluster.Status = models.StatusLocked
			cluster.AssignedSession = sessionID
			cluster.LockTime = time.Now()

			m.logger.WithFields(logrus.Fields{
				"clusterID": clusterID,
				"sessionID": sessionID,
			}).Info("Cluster assigned to session")

			// Return a copy to avoid external modifications
			clusterCopy := *cluster
			return &clusterCopy, nil
		}
	}

	return nil, fmt.Errorf("no available clusters in pool")
}

// ReleaseCluster releases a cluster from a session
func (m *Manager) ReleaseCluster(sessionID string) error {
	m.lock.Lock()
	defer m.lock.Unlock()

	// Find cluster assigned to this session
	for clusterID, cluster := range m.clusters {
		if cluster.AssignedSession == sessionID {
			// Mark for reset
			cluster.Status = models.StatusResetting
			cluster.AssignedSession = ""
			cluster.LockTime = time.Time{}

			m.logger.WithFields(logrus.Fields{
				"clusterID": clusterID,
				"sessionID": sessionID,
			}).Info("Cluster released and marked for reset")

			// Trigger async reset
			go m.resetClusterAsync(clusterID)

			return nil
		}
	}

	return fmt.Errorf("no cluster found for session %s", sessionID)
}

// GetPoolStatus returns current pool statistics
func (m *Manager) GetPoolStatus() *models.ClusterPoolStats {
	m.lock.RLock()
	defer m.lock.RUnlock()

	stats := &models.ClusterPoolStats{
		TotalClusters:   len(m.clusters),
		StatusByCluster: make(map[string]models.ClusterStatus),
	}

	for clusterID, cluster := range m.clusters {
		stats.StatusByCluster[clusterID] = cluster.Status

		switch cluster.Status {
		case models.StatusAvailable:
			stats.AvailableClusters++
		case models.StatusLocked:
			stats.LockedClusters++
		case models.StatusResetting:
			stats.ResettingClusters++
		case models.StatusError:
			stats.ErrorClusters++
		}
	}

	return stats
}

// GetClusterByID returns a cluster by ID
func (m *Manager) GetClusterByID(clusterID string) (*models.ClusterPool, error) {
	m.lock.RLock()
	defer m.lock.RUnlock()

	cluster, exists := m.clusters[clusterID]
	if !exists {
		return nil, fmt.Errorf("cluster %s not found", clusterID)
	}

	// Return a copy
	clusterCopy := *cluster
	return &clusterCopy, nil
}

// MarkClusterAvailable marks a cluster as available after bootstrap
func (m *Manager) MarkClusterAvailable(clusterID string) error {
	m.lock.Lock()
	defer m.lock.Unlock()

	cluster, exists := m.clusters[clusterID]
	if !exists {
		return fmt.Errorf("cluster %s not found", clusterID)
	}

	cluster.Status = models.StatusAvailable
	m.logger.WithField("clusterID", clusterID).Info("Cluster marked as available")
	return nil
}

// resetClusterAsync performs cluster reset in background
func (m *Manager) resetClusterAsync(clusterID string) {
	m.logger.WithField("clusterID", clusterID).Info("Starting cluster reset")

	// TODO: Implement snapshot-based reset in Phase 2
	// For now, just mark as available after a delay to simulate reset
	time.Sleep(10 * time.Second)

	m.lock.Lock()
	if cluster, exists := m.clusters[clusterID]; exists {
		cluster.Status = models.StatusAvailable
		cluster.LastReset = time.Now()
	}
	m.lock.Unlock()

	m.logger.WithField("clusterID", clusterID).Info("Cluster reset completed")
}

// maintenanceLoop performs periodic maintenance tasks
func (m *Manager) maintenanceLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			m.performMaintenance()
		case <-m.stopCh:
			return
		}
	}
}

// performMaintenance checks cluster health and performs cleanup
func (m *Manager) performMaintenance() {
	m.lock.Lock()
	defer m.lock.Unlock()

	m.logger.Debug("Performing cluster pool maintenance")

	for clusterID, cluster := range m.clusters {
		cluster.LastHealthCheck = time.Now()

		// TODO: Add actual health checks in later phases
		m.logger.WithFields(logrus.Fields{
			"clusterID":       clusterID,
			"status":          cluster.Status,
			"assignedSession": cluster.AssignedSession,
		}).Debug("Cluster maintenance check")
	}
}

// Stop gracefully shuts down the cluster pool manager
func (m *Manager) Stop() {
	close(m.stopCh)
	m.logger.Info("Cluster pool manager stopped")
}
