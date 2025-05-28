# Cluster Pool Approach - VM Provisioning Optimization

## Executive Summary

**Problem**: Cross-namespace VM cloning has fundamental limitations that prevent our snapshot-based approach from working reliably.

**New Solution**: Pre-built cluster pool with session locking and snapshot-based reset mechanism.

**Impact**: Near-instantaneous session provisioning (< 30 seconds vs 8+ minutes)

**Scope**: Single-user system with 3-cluster pool, clean implementation replacing existing provisioning system.

---

## Problem Statement

### Current Roadblocks with Snapshot Approach
1. **Cross-namespace VM cloning**: KubeVirt doesn't support reliable cross-namespace VM operations
2. **VMExport authentication**: Generated tokens create authentication barriers for DataVolume imports
3. **Unnecessary complexity**: IP management isn't actually needed since Kubernetes bootstrap handles node discovery dynamically
4. **Development overhead**: Complex workarounds don't solve the fundamental provisioning speed issue

### Root Cause Analysis
- Current approach tries to solve wrong problem (IP conflicts don't actually matter in K8s bootstrap)
- Cross-namespace operations add unnecessary complexity layers
- Snapshot-based cloning is the wrong abstraction - we need **ready clusters**, not **ready images**

---

## New Approach: Pre-built Cluster Pool

### Core Concept
Maintain a pool of **3 pre-built, ready-to-use Kubernetes clusters** that can be instantly assigned to user sessions.

### Simplified Architecture
```
┌─────────────────────────────────────────────────────┐
│                  KubeVirt Cluster                   │
├─────────────────────────────────────────────────────┤
│  vm-templates namespace                             │
│  ├── cluster1-control-plane-base-snapshot          │
│  ├── cluster1-worker-node-base-snapshot            │
│  ├── cluster2-control-plane-base-snapshot          │
│  ├── cluster2-worker-node-base-snapshot            │  
│  └── cluster3-control-plane-base-snapshot          │
│      cluster3-worker-node-base-snapshot            │
├─────────────────────────────────────────────────────┤
│  Active Clusters (Personal Use - 3 clusters)       │
│  ├── cluster1 namespace (AVAILABLE)                │
│  ├── cluster2 namespace (LOCKED: session-abc123)   │
│  └── cluster3 namespace (RESETTING)                │
└─────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Static Cluster Pool (3 clusters)
- **3 pre-built clusters** in ready state
- Each cluster has dedicated namespace: `cluster1`, `cluster2`, `cluster3`
- Dynamic IP assignment (no static IP management needed)
- Clusters maintained in `AVAILABLE`, `LOCKED`, or `RESETTING` states

#### 2. Session Assignment Logic
- User requests new session → System finds `AVAILABLE` cluster
- Cluster locked to session → Status: `LOCKED: session-{id}`
- User gets immediate access to fully functional cluster
- Session timeout → Cluster enters `RESETTING` state

#### 3. Cluster Reset Mechanism
- Snapshot-based restore to clean baseline state
- Fast reset (2-3 minutes) vs full provision (8+ minutes)
- Automated cleanup of user artifacts
- Return to `AVAILABLE` pool

---

## Implementation Strategy

### Single Sprint Implementation (2-3 weeks)
**Approach**: Clean replacement of existing provisioning system
**Target**: 3-cluster pool for single-user system

---

## Technical Architecture

### Database Schema Changes
```go
// Update Session model
type Session struct {
    // ... existing fields
    AssignedCluster  string    `json:"assignedCluster"`  // "cluster1", "cluster2", "cluster3"
    ClusterLockTime  time.Time `json:"clusterLockTime"`
}

// New ClusterPool model  
type ClusterPool struct {
    ClusterID       string            `json:"clusterId"`     // "cluster1", "cluster2", "cluster3"
    Namespace       string            `json:"namespace"`     // matches clusterID
    Status          ClusterStatus     `json:"status"`
    AssignedSession string            `json:"assignedSession,omitempty"`
    LockTime        time.Time         `json:"lockTime,omitempty"`
    LastReset       time.Time         `json:"lastReset"`
    ControlPlaneVM  string            `json:"controlPlaneVM"`
    WorkerNodeVM    string            `json:"workerNodeVM"`
}

type ClusterStatus string
const (
    StatusAvailable ClusterStatus = "available"
    StatusLocked    ClusterStatus = "locked" 
    StatusResetting ClusterStatus = "resetting"
    StatusError     ClusterStatus = "error"
)
```

### API Architecture
```go
// New cluster pool manager (replaces SessionManager provisioning logic)
type ClusterPoolManager struct {
    clusters        map[string]*ClusterPool  // 3 clusters: cluster1, cluster2, cluster3
    lock           sync.RWMutex
    kubevirtClient *kubevirt.Client
    logger         *logrus.Logger
}

// Key methods
func (cpm *ClusterPoolManager) AssignCluster(sessionID string) (*ClusterPool, error)
func (cpm *ClusterPoolManager) ReleaseCluster(sessionID string) error  
func (cpm *ClusterPoolManager) ResetCluster(clusterID string) error
func (cpm *ClusterPoolManager) GetPoolStatus() [3]ClusterStatus
```

---

## User Experience Flow

### Current Experience (8+ minutes)
```
User clicks "Start Lab" 
→ Wait 8+ minutes for VMs to provision
→ Wait for Kubernetes bootstrap
→ Wait for scenario setup  
→ Begin tasks
```

### New Experience (< 30 seconds)
```
User clicks "Start Lab"
→ System assigns available cluster (< 5 seconds)
→ User connects to ready cluster (< 10 seconds)
→ Scenario setup if needed (< 15 seconds)
→ Begin tasks immediately
```

---

## Resource Requirements

### Infrastructure (Personal Use)
- **Additional CPU**: ~12 cores (3 clusters × 4 cores each)
- **Additional Memory**: ~24GB (3 clusters × 8GB each)  
- **Storage**: Snapshots + active clusters (~300GB estimated)

### Development Effort
- **Backend replacement**: 2 weeks
- **Frontend updates**: 3-4 days
- **Testing & validation**: 2-3 days

---

## Success Metrics

### Performance Targets
- **Provisioning time**: < 30 seconds (vs 8+ minutes current)
- **Pool utilization**: Simple rotation of 3 clusters
- **Reset time**: < 3 minutes per cluster  
- **System reliability**: No pool exhaustion (single user)

---

## Migration Strategy

### Clean Replacement Approach
1. **Remove old provisioning logic** from SessionManager
2. **Replace with cluster assignment logic**
3. **Update terminal routing** to use assigned clusters
4. **Clean up old code paths** and templates
5. **Remove snapshot-based provisioning code**

**Benefits:**
- Clean, maintainable codebase
- No backward compatibility complexity
- Shorter implementation time
- Less code to maintain long-term

---

## Conclusion

The cluster pool approach fundamentally solves the IP dependency and cross-namespace limitations while delivering dramatic performance improvements. This architecture trades some resource overhead for massive user experience gains and system reliability improvements.

**Next Steps:**
1. Validate resource availability for cluster pool
2. Create detailed technical specifications
3. Begin Phase 1 implementation
4. Establish monitoring and alerting framework

**Success Definition:**
- Sub-30-second session provisioning
- Reliable cluster assignment
- Automated pool maintenance
- 99.5% system availability