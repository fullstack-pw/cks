# VM Provisioning Optimization Plan

## Executive Summary

**Problem**: VM provisioning takes 10-15 minutes due to full Kubernetes bootstrap process
**Solution**: KubeVirt snapshots of pre-built clusters with intelligent fallback
**Impact**: 80-85% reduction in provisioning time (2-3 minutes vs 10-15 minutes)

### Strategy Overview
1. **Snapshot-First**: Use KubeVirt VirtualMachineSnapshots of ready 2-node clusters
2. **Smart Fallback**: Auto-detect snapshot availability, fallback to optimized bootstrap
3. **Parallel Processing**: Create both VMs simultaneously when bootstrapping
4. **Zero Downtime**: Additive changes that don't break existing functionality

### Implementation Phases
- **Phase 1**: Fallback framework (1-2 days, Low risk)
- **Phase 2**: Bootstrap optimization + parallel creation (2-3 days, Medium risk)  
- **Phase 3**: Snapshot infrastructure (3-4 days, Low risk)
- **Phase 4**: Fast snapshot provisioning (2-3 days, Medium risk)
- **Phase 5**: Integration & polish (1-2 days, Low risk)

### Key Technical Decisions
- **Snapshot Storage**: KubeVirt VirtualMachineSnapshots (faster than DataVolume clones)
- **Certificate Handling**: Keep existing certs (simplest, personal use)
- **Network Isolation**: Not needed (personal use, single scenario at a time)
- **State Reset**: Minimal (clean logs/temp files only)

### Expected Results
- **Week 1-2**: 30-40% improvement via bootstrap optimization
- **Week 3-4**: 80-85% improvement via snapshot provisioning
- **Fallback Safety**: Always works even if snapshots fail

---

## Overview
Transform VM provisioning from 10-15 minutes to 2-3 minutes using KubeVirt VirtualMachineSnapshots with intelligent fallback to optimized bootstrap when snapshots don't exist.

## Current State Analysis
- **Current Time**: 10-15 minutes
- **Target Time**: 2-3 minutes  
- **Improvement**: ~80-85% faster
- **Strategy**: KubeVirt snapshots with bootstrap fallback

---

## Phase 1: Snapshot Detection & Fallback Framework
**Goal**: Implement smart provisioning strategy selection without breaking existing functionality
**Duration**: 1-2 days
**Risk**: Low (additive changes)

### Step 1.1: Add Provisioning Strategy Types
**File**: `backend/internal/models/models.go`
```go
// Add new types
type ProvisioningStrategy int

const (
    StrategyBootstrap ProvisioningStrategy = iota
    StrategySnapshot
)

type SnapshotInfo struct {
    ControlPlaneSnapshotName string `json:"controlPlaneSnapshot"`
    WorkerSnapshotName       string `json:"workerSnapshot"`
    CreatedAt               time.Time `json:"createdAt"`
    K8sVersion              string `json:"k8sVersion"`
    Status                  string `json:"status"`
}
```

### Step 1.2: Add Snapshot Detection Methods
**File**: `backend/internal/sessions/session_manager.go`
```go
// Add methods to SessionManager
func (sm *SessionManager) determineProvisioningStrategy(ctx context.Context) ProvisioningStrategy {
    if sm.snapshotsExist(ctx) {
        return StrategySnapshot
    }
    return StrategyBootstrap
}

func (sm *SessionManager) snapshotsExist(ctx context.Context) bool {
    // Check if both snapshots exist and are ready
    controlPlaneExists := sm.checkSnapshotExists(ctx, "cks-control-plane-base-snapshot")
    workerExists := sm.checkSnapshotExists(ctx, "cks-worker-base-snapshot")
    return controlPlaneExists && workerExists
}

func (sm *SessionManager) checkSnapshotExists(ctx context.Context, snapshotName string) bool {
    // Use KubeVirt client to check VirtualMachineSnapshot existence
}
```

### Step 1.3: Refactor provisionEnvironment Method
**File**: `backend/internal/sessions/session_manager.go`
```go
func (sm *SessionManager) provisionEnvironment(ctx context.Context, session *models.Session) error {
    // Existing status update code...
    
    strategy := sm.determineProvisioningStrategy(ctx)
    
    switch strategy {
    case StrategySnapshot:
        return sm.provisionFromSnapshot(ctx, session)
    case StrategyBootstrap:
        return sm.provisionFromBootstrap(ctx, session)
    default:
        return fmt.Errorf("unknown provisioning strategy")
    }
}
```

### Step 1.4: Extract Current Logic to Bootstrap Method
**File**: `backend/internal/sessions/session_manager.go`
```go
func (sm *SessionManager) provisionFromBootstrap(ctx context.Context, session *models.Session) error {
    // Move existing provisioning logic here
    // Keep all current functionality intact
    return sm.provisionFromBootstrapOptimized(ctx, session)
}
```

### Step 1.5: Add Placeholder Snapshot Method
**File**: `backend/internal/sessions/session_manager.go`
```go
func (sm *SessionManager) provisionFromSnapshot(ctx context.Context, session *models.Session) error {
    // Placeholder implementation
    sm.logger.Info("Snapshot provisioning not yet implemented, falling back to bootstrap")
    return sm.provisionFromBootstrap(ctx, session)
}
```

**Validation**: System works exactly as before but with new framework in place

---

## Phase 2: Bootstrap Optimization & Parallel VM Creation
**Goal**: Optimize existing bootstrap while maintaining compatibility
**Duration**: 2-3 days
**Risk**: Medium (modifies existing flow)

### Step 2.1: Optimize Resource Quota Setup
**File**: `backend/internal/sessions/session_manager.go`
```go
func (sm *SessionManager) setupResourceQuotasOptimized(ctx context.Context, namespace string) error {
    // Reduce retry attempts
    backoff := wait.Backoff{
        Steps:    3,        // Reduced from 5
        Duration: 500 * time.Millisecond, // Faster initial retry
        Factor:   1.5,      // Reduced from 2.0
        Jitter:   0.05,     // Reduced jitter
    }
    
    // Pre-check namespace existence before creating quota
    // Implement fast-fail for common errors
}
```

### Step 2.2: Implement Parallel VM Creation
**File**: `backend/internal/kubevirt/client.go`
```go
func (c *Client) CreateClusterParallel(ctx context.Context, namespace, controlPlaneName, workerNodeName string) error {
    // Create both cloud-init secrets in parallel
    errChan := make(chan error, 2)
    
    go func() {
        err := c.createCloudInitSecret(ctx, namespace, controlPlaneName, "control-plane")
        errChan <- err
    }()
    
    go func() {
        // Create worker secret without join command dependency
        err := c.createCloudInitSecretWorkerAsync(ctx, namespace, workerNodeName)
        errChan <- err
    }()
    
    // Wait for both secrets
    for i := 0; i < 2; i++ {
        if err := <-errChan; err != nil {
            return err
        }
    }
    
    // Create both VMs in parallel
    go func() {
        err := c.createVM(ctx, namespace, controlPlaneName, "control-plane")
        errChan <- err
    }()
    
    go func() {
        err := c.createVM(ctx, namespace, workerNodeName, "worker")
        errChan <- err
    }()
    
    // Wait for both VMs
    for i := 0; i < 2; i++ {
        if err := <-errChan; err != nil {
            return err
        }
    }
    
    return c.WaitForVMsReadyParallel(ctx, namespace, controlPlaneName, workerNodeName)
}
```

### Step 2.3: Extract Join Command to Session Management
**File**: `backend/internal/sessions/session_manager.go`
```go
type SessionManager struct {
    // Add join command management
    joinCommands map[string]string // sessionID -> joinCommand
    joinMutex    sync.RWMutex
}

func (sm *SessionManager) getOrCreateJoinCommand(ctx context.Context, session *models.Session) (string, error) {
    sm.joinMutex.RLock()
    if cmd, exists := sm.joinCommands[session.ID]; exists {
        sm.joinMutex.RUnlock()
        return cmd, nil
    }
    sm.joinMutex.RUnlock()
    
    // Generate join command asynchronously
    cmd, err := sm.generateJoinCommand(ctx, session)
    if err != nil {
        return "", err
    }
    
    sm.joinMutex.Lock()
    sm.joinCommands[session.ID] = cmd
    sm.joinMutex.Unlock()
    
    return cmd, nil
}
```

### Step 2.4: Optimize VM Ready Detection
**File**: `backend/internal/kubevirt/client.go`
```go
func (c *Client) WaitForVMsReadyParallel(ctx context.Context, namespace string, vmNames ...string) error {
    errChan := make(chan error, len(vmNames))
    
    for _, vmName := range vmNames {
        go func(name string) {
            err := c.WaitForVMReadyOptimized(ctx, namespace, name)
            errChan <- err
        }(vmName)
    }
    
    for i := 0; i < len(vmNames); i++ {
        if err := <-errChan; err != nil {
            return err
        }
    }
    
    return nil
}

func (c *Client) WaitForVMReadyOptimized(ctx context.Context, namespace, vmName string) error {
    return wait.PollUntilContextCancel(ctx, 5*time.Second, true, func(context.Context) (bool, error) {
        // Optimized ready check with faster polling
        // Check VMI phase first (faster than VM status)
        vmi, err := c.virtClient.VirtualMachineInstance(namespace).Get(ctx, vmName, metav1.GetOptions{})
        if err != nil {
            return false, nil
        }
        
        return vmi.Status.Phase == "Running", nil
    })
}
```

**Expected Improvement**: 30-40% faster bootstrap (8-10 minutes instead of 12-15)

---

## Phase 3: Snapshot Creation Infrastructure
**Goal**: Implement base cluster creation and snapshot management
**Duration**: 3-4 days
**Risk**: Low (independent system)

### Step 3.1: Add KubeVirt Snapshot Support
**File**: `backend/internal/kubevirt/client.go`
```go
import (
    snapshotv1alpha1 "kubevirt.io/api/snapshot/v1alpha1"
)

func (c *Client) CreateVMSnapshot(ctx context.Context, namespace, vmName, snapshotName string) error {
    snapshot := &snapshotv1alpha1.VirtualMachineSnapshot{
        ObjectMeta: metav1.ObjectMeta{
            Name:      snapshotName,
            Namespace: namespace,
        },
        Spec: snapshotv1alpha1.VirtualMachineSnapshotSpec{
            Source: corev1.TypedLocalObjectReference{
                APIVersion: "kubevirt.io/v1",
                Kind:       "VirtualMachine",
                Name:       vmName,
            },
        },
    }
    
    _, err := c.virtClient.VirtualMachineSnapshot(namespace).Create(ctx, snapshot, metav1.CreateOptions{})
    return err
}

func (c *Client) WaitForSnapshotReady(ctx context.Context, namespace, snapshotName string) error {
    return wait.PollUntilContextCancel(ctx, 10*time.Second, true, func(context.Context) (bool, error) {
        snapshot, err := c.virtClient.VirtualMachineSnapshot(namespace).Get(ctx, snapshotName, metav1.GetOptions{})
        if err != nil {
            return false, nil
        }
        
        return snapshot.Status != nil && snapshot.Status.ReadyToUse != nil && *snapshot.Status.ReadyToUse, nil
    })
}
```

### Step 3.2: Add Base Cluster Creation
**File**: `backend/internal/sessions/session_manager.go`
```go
func (sm *SessionManager) CreateBaseClusterSnapshot(ctx context.Context) error {
    sm.logger.Info("Creating base cluster for snapshot")
    
    // Create a special bootstrap session
    baseSession := &models.Session{
        ID:             "base-cluster",
        Namespace:      "vm-templates",
        Status:         models.SessionStatusProvisioning,
        ControlPlaneVM: "cks-control-plane-base",
        WorkerNodeVM:   "cks-worker-node-base",
    }
    
    // Create namespace for base cluster
    err := sm.createNamespace(ctx, baseSession.Namespace)
    if err != nil {
        return fmt.Errorf("failed to create base namespace: %w", err)
    }
    
    // Provision using optimized bootstrap
    err = sm.provisionFromBootstrapOptimized(ctx, baseSession)
    if err != nil {
        return fmt.Errorf("failed to provision base cluster: %w", err)
    }
    
    // Wait extra time for cluster to be fully stable
    sm.logger.Info("Waiting for base cluster to stabilize")
    time.Sleep(2 * time.Minute)
    
    // Clean cluster state
    err = sm.cleanBaseClusterState(ctx, baseSession)
    if err != nil {
        return fmt.Errorf("failed to clean base cluster: %w", err)
    }
    
    // Create snapshots
    return sm.createSnapshots(ctx, baseSession)
}

func (sm *SessionManager) cleanBaseClusterState(ctx context.Context, session *models.Session) error {
    commands := []string{
        // Clear logs
        "sudo journalctl --vacuum-time=1s",
        "sudo rm -rf /var/log/*.log",
        "sudo rm -rf /tmp/*",
        
        // Clear bash history
        "history -c",
        "rm -f ~/.bash_history",
        
        // Clear kubectl cache
        "rm -rf ~/.kube/cache",
        
        // Remove any test pods/resources
        "kubectl delete pods --all --all-namespaces --ignore-not-found",
        "kubectl delete pvc --all --all-namespaces --ignore-not-found",
    }
    
    for _, cmd := range commands {
        // Execute on both VMs
        sm.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, session.ControlPlaneVM, cmd)
        sm.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, session.WorkerNodeVM, cmd)
    }
    
    return nil
}
```

### Step 3.3: Implement Snapshot Creation
**File**: `backend/internal/sessions/session_manager.go`
```go
func (sm *SessionManager) createSnapshots(ctx context.Context, session *models.Session) error {
    // Stop VMs for consistent snapshot
    sm.logger.Info("Stopping VMs for snapshot")
    err := sm.kubevirtClient.StopVMs(ctx, session.Namespace, session.ControlPlaneVM, session.WorkerNodeVM)
    if err != nil {
        return fmt.Errorf("failed to stop VMs: %w", err)
    }
    
    // Create snapshots in parallel
    errChan := make(chan error, 2)
    
    go func() {
        err := sm.kubevirtClient.CreateVMSnapshot(ctx, session.Namespace, session.ControlPlaneVM, "cks-control-plane-base-snapshot")
        errChan <- err
    }()
    
    go func() {
        err := sm.kubevirtClient.CreateVMSnapshot(ctx, session.Namespace, session.WorkerNodeVM, "cks-worker-base-snapshot")
        errChan <- err
    }()
    
    // Wait for both snapshots
    for i := 0; i < 2; i++ {
        if err := <-errChan; err != nil {
            return err
        }
    }
    
    // Wait for snapshots to be ready
    go func() {
        err := sm.kubevirtClient.WaitForSnapshotReady(ctx, session.Namespace, "cks-control-plane-base-snapshot")
        errChan <- err
    }()
    
    go func() {
        err := sm.kubevirtClient.WaitForSnapshotReady(ctx, session.Namespace, "cks-worker-base-snapshot")
        errChan <- err
    }()
    
    for i := 0; i < 2; i++ {
        if err := <-errChan; err != nil {
            return err
        }
    }
    
    sm.logger.Info("Base cluster snapshots created successfully")
    return nil
}
```

### Step 3.4: Add Admin Endpoints
**File**: `backend/internal/controllers/admin_controller.go` (new file)
```go
package controllers

type AdminController struct {
    sessionManager *sessions.SessionManager
    logger         *logrus.Logger
}

func (ac *AdminController) RegisterRoutes(router *gin.Engine) {
    admin := router.Group("/api/v1/admin")
    {
        admin.POST("/snapshots/create", ac.CreateBaseSnapshot)
        admin.GET("/snapshots/status", ac.GetSnapshotStatus)
        admin.DELETE("/snapshots", ac.DeleteSnapshots)
        admin.POST("/snapshots/recreate", ac.RecreateSnapshots)
    }
}

func (ac *AdminController) CreateBaseSnapshot(c *gin.Context) {
    ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Minute)
    defer cancel()
    
    err := ac.sessionManager.CreateBaseClusterSnapshot(ctx)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(http.StatusOK, gin.H{"message": "Base snapshots created successfully"})
}
```

**Deliverable**: Admin can create base snapshots via API

---

## Phase 4: Fast Snapshot-based Provisioning
**Goal**: Implement 2-3 minute provisioning using snapshots
**Duration**: 2-3 days
**Risk**: Medium (new provisioning path)

### Step 4.1: Implement VM Restore from Snapshot
**File**: `backend/internal/kubevirt/client.go`
```go
func (c *Client) CreateVMFromSnapshot(ctx context.Context, namespace, vmName, snapshotNamespace, snapshotName string) error {
    restore := &snapshotv1alpha1.VirtualMachineRestore{
        ObjectMeta: metav1.ObjectMeta{
            Name:      fmt.Sprintf("%s-restore", vmName),
            Namespace: namespace,
        },
        Spec: snapshotv1alpha1.VirtualMachineRestoreSpec{
            Target: corev1.TypedLocalObjectReference{
                APIVersion: "kubevirt.io/v1",
                Kind:       "VirtualMachine",
                Name:       vmName,
            },
            VirtualMachineSnapshotName: snapshotName,
        },
    }
    
    _, err := c.virtClient.VirtualMachineRestore(namespace).Create(ctx, restore, metav1.CreateOptions{})
    if err != nil {
        return err
    }
    
    return c.WaitForRestoreComplete(ctx, namespace, restore.Name)
}

func (c *Client) WaitForRestoreComplete(ctx context.Context, namespace, restoreName string) error {
    return wait.PollUntilContextCancel(ctx, 5*time.Second, true, func(context.Context) (bool, error) {
        restore, err := c.virtClient.VirtualMachineRestore(namespace).Get(ctx, restoreName, metav1.GetOptions{})
        if err != nil {
            return false, nil
        }
        
        return restore.Status != nil && restore.Status.Complete != nil && *restore.Status.Complete, nil
    })
}
```

### Step 4.2: Implement Snapshot-based Cluster Creation
**File**: `backend/internal/kubevirt/client.go`
```go
func (c *Client) CreateClusterFromSnapshot(ctx context.Context, namespace, controlPlaneName, workerNodeName string) error {
    // Create both VMs from snapshots in parallel
    errChan := make(chan error, 2)
    
    go func() {
        err := c.CreateVMFromSnapshot(ctx, namespace, controlPlaneName, "vm-templates", "cks-control-plane-base-snapshot")
        errChan <- err
    }()
    
    go func() {
        err := c.CreateVMFromSnapshot(ctx, namespace, workerNodeName, "vm-templates", "cks-worker-base-snapshot")
        errChan <- err
    }()
    
    // Wait for both restores
    for i := 0; i < 2; i++ {
        if err := <-errChan; err != nil {
            return err
        }
    }
    
    // Start both VMs
    go func() {
        err := c.StartVM(ctx, namespace, controlPlaneName)
        errChan <- err
    }()
    
    go func() {
        err := c.StartVM(ctx, namespace, workerNodeName)
        errChan <- err
    }()
    
    for i := 0; i < 2; i++ {
        if err := <-errChan; err != nil {
            return err
        }
    }
    
    return c.WaitForVMsReadyOptimized(ctx, namespace, controlPlaneName, workerNodeName)
}
```

### Step 4.3: Implement Fast Provisioning Method
**File**: `backend/internal/sessions/session_manager.go`
```go
func (sm *SessionManager) provisionFromSnapshot(ctx context.Context, session *models.Session) error {
    sm.logger.WithField("sessionID", session.ID).Info("Provisioning from snapshot")
    
    // Update status
    if err := sm.UpdateSessionStatus(session.ID, models.SessionStatusProvisioning, "Creating VMs from snapshot"); err != nil {
        return err
    }
    
    // Create namespace (fast)
    err := sm.createNamespace(ctx, session.Namespace)
    if err != nil {
        return fmt.Errorf("failed to create namespace: %w", err)
    }
    
    // Skip resource quotas for snapshot-based provisioning (they're pre-configured)
    
    // Create VMs from snapshots (fast)
    vmCtx, cancelVM := context.WithTimeout(ctx, 5*time.Minute) // Much shorter timeout
    defer cancelVM()
    
    err = sm.kubevirtClient.CreateClusterFromSnapshot(vmCtx, session.Namespace, session.ControlPlaneVM, session.WorkerNodeVM)
    if err != nil {
        sm.UpdateSessionStatus(session.ID, models.SessionStatusFailed, fmt.Sprintf("Failed to create VMs from snapshot: %v", err))
        return fmt.Errorf("failed to create VMs from snapshot: %w", err)
    }
    
    // Minimal post-boot configuration
    err = sm.configureSnapshotCluster(ctx, session)
    if err != nil {
        sm.UpdateSessionStatus(session.ID, models.SessionStatusFailed, fmt.Sprintf("Failed to configure cluster: %v", err))
        return fmt.Errorf("failed to configure cluster: %w", err)
    }
    
    // Update final status
    if err := sm.UpdateSessionStatus(session.ID, models.SessionStatusRunning, ""); err != nil {
        return err
    }
    
    sm.logger.WithField("sessionID", session.ID).Info("Snapshot provisioning completed")
    return nil
}

func (sm *SessionManager) configureSnapshotCluster(ctx context.Context, session *models.Session) error {
    // Minimal configuration needed after snapshot restore
    commands := []string{
        // Update hostname (might be needed)
        fmt.Sprintf("sudo hostnamectl set-hostname %s", session.ControlPlaneVM),
        
        // Restart kubelet to pick up any changes
        "sudo systemctl restart kubelet",
        
        // Wait for node to be ready
        "kubectl wait --for=condition=Ready nodes --all --timeout=60s",
    }
    
    for _, cmd := range commands {
        _, err := sm.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, session.ControlPlaneVM, cmd)
        if err != nil {
            sm.logger.WithError(err).WithField("command", cmd).Warn("Post-snapshot command failed")
            // Don't fail provisioning for non-critical commands
        }
    }
    
    return nil
}
```

### Step 4.4: Update Strategy Selection Logic
**File**: `backend/internal/sessions/session_manager.go`
```go
func (sm *SessionManager) snapshotsExist(ctx context.Context) bool {
    // Check snapshots in vm-templates namespace
    controlPlaneExists := sm.checkSnapshotReady(ctx, "vm-templates", "cks-control-plane-base-snapshot")
    workerExists := sm.checkSnapshotReady(ctx, "vm-templates", "cks-worker-base-snapshot")
    
    sm.logger.WithFields(logrus.Fields{
        "controlPlaneSnapshot": controlPlaneExists,
        "workerSnapshot":       workerExists,
    }).Debug("Snapshot availability check")
    
    return controlPlaneExists && workerExists
}

func (sm *SessionManager) checkSnapshotReady(ctx context.Context, namespace, snapshotName string) bool {
    snapshot, err := sm.kubevirtClient.VirtClient().VirtualMachineSnapshot(namespace).Get(ctx, snapshotName, metav1.GetOptions{})
    if err != nil {
        return false
    }
    
    return snapshot.Status != nil && snapshot.Status.ReadyToUse != nil && *snapshot.Status.ReadyToUse
}
```

**Expected Result**: 2-3 minute provisioning when snapshots exist

---

## Phase 5: Integration & Polish
**Goal**: Integrate all components and add management features
**Duration**: 1-2 days
**Risk**: Low (integration and polish)

### Step 5.1: Add Snapshot Management to Admin API
**File**: `backend/internal/controllers/admin_controller.go`
```go
func (ac *AdminController) GetSnapshotStatus(c *gin.Context) {
    ctx := c.Request.Context()
    
    status := map[string]interface{}{
        "snapshots": map[string]interface{}{
            "controlPlane": ac.getSnapshotInfo(ctx, "vm-templates", "cks-control-plane-base-snapshot"),
            "worker":       ac.getSnapshotInfo(ctx, "vm-templates", "cks-worker-base-snapshot"),
        },
        "strategy": func() string {
            if ac.sessionManager.SnapshotsExist(ctx) {
                return "snapshot"
            }
            return "bootstrap"
        }(),
    }
    
    c.JSON(http.StatusOK, status)
}

func (ac *AdminController) RecreateSnapshots(c *gin.Context) {
    ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Minute)
    defer cancel()
    
    // Delete existing snapshots
    ac.sessionManager.DeleteBaseSnapshots(ctx)
    
    // Create new ones
    err := ac.sessionManager.CreateBaseClusterSnapshot(ctx)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(http.StatusOK, gin.H{"message": "Snapshots recreated successfully"})
}
```

### Step 5.2: Add Frontend Integration
**File**: `frontend/pages/admin.js` (new file)
```jsx
import React, { useState, useEffect } from 'react';
import { Button, Card, LoadingState, StatusIndicator } from '../components/common';

export default function AdminPage() {
    const [snapshotStatus, setSnapshotStatus] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    
    const createSnapshots = async () => {
        setIsCreating(true);
        try {
            const response = await fetch('/api/v1/admin/snapshots/create', {
                method: 'POST'
            });
            if (response.ok) {
                await loadSnapshotStatus();
            }
        } finally {
            setIsCreating(false);
        }
    };
    
    return (
        <div className="container mx-auto px-4 py-8">
            <h1 className="text-2xl font-bold mb-6">System Administration</h1>
            
            <Card>
                <h2 className="text-lg font-medium mb-4">VM Provisioning</h2>
                <div className="space-y-4">
                    <div>
                        <strong>Current Strategy:</strong> 
                        <span className="ml-2">{snapshotStatus?.strategy || 'Unknown'}</span>
                    </div>
                    
                    <div>
                        <strong>Snapshots Status:</strong>
                        <div className="mt-2 space-y-2">
                            <div className="flex items-center">
                                <StatusIndicator 
                                    status={snapshotStatus?.snapshots?.controlPlane?.ready ? 'connected' : 'disconnected'} 
                                    label="Control Plane Snapshot"
                                />
                            </div>
                            <div className="flex items-center">
                                <StatusIndicator 
                                    status={snapshotStatus?.snapshots?.worker?.ready ? 'connected' : 'disconnected'} 
                                    label="Worker Node Snapshot"
                                />
                            </div>
                        </div>
                    </div>
                    
                    <div className="pt-4">
                        <Button
                            variant="primary"
                            onClick={createSnapshots}
                            isLoading={isCreating}
                            disabled={isCreating}
                        >
                            {snapshotStatus?.strategy === 'snapshot' ? 'Recreate Snapshots' : 'Create Base Snapshots'}
                        </Button>
                    </div>
                </div>
            </Card>
        </div>
    );
}
```

### Step 5.3: Add Performance Monitoring
**File**: `backend/internal/sessions/session_manager.go`
```go
func (sm *SessionManager) provisionEnvironment(ctx context.Context, session *models.Session) error {
    startTime := time.Now()
    strategy := sm.determineProvisioningStrategy(ctx)
    
    sm.logger.WithFields(logrus.Fields{
        "sessionID": session.ID,
        "strategy":  strategy,
        "startTime": startTime,
    }).Info("Starting environment provisioning")
    
    var err error
    switch strategy {
    case StrategySnapshot:
        err = sm.provisionFromSnapshot(ctx, session)
    case StrategyBootstrap:
        err = sm.provisionFromBootstrap(ctx, session)
    }
    
    duration := time.Since(startTime)
    sm.logger.WithFields(logrus.Fields{
        "sessionID": session.ID,
        "strategy":  strategy,
        "duration":  duration,
        "success":   err == nil,
    }).Info("Environment provisioning completed")
    
    return err
}
```

### Step 5.4: Documentation and Testing
- Update API documentation
- Add snapshot management guide
- Create troubleshooting guide
- Test failover scenarios

---

## Rollout Strategy

### Week 1: Foundation
- Implement Phase 1 (Fallback Framework)
- Test that existing functionality still works
- Deploy to staging

### Week 2: Optimization
- Implement Phase 2 (Bootstrap Optimization)
- Measure performance improvements
- Create first base snapshots manually

### Week 3: Snapshot Infrastructure  
- Implement Phase 3 (Snapshot Creation)
- Test snapshot creation and validation
- Automate snapshot management

### Week 4: Fast Provisioning
- Implement Phase 4 (Snapshot-based Provisioning)
- Performance testing and optimization
- Implement Phase 5 (Integration)

### Week 5: Deployment & Monitoring
- Production deployment
- Performance monitoring
- Documentation completion
