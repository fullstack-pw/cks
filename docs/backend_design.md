# docs/backend-design.md - Technical design document for the backend service

# KillerKoda-Local Backend Service Design

## Overview

The KillerKoda-Local backend service is responsible for managing CKS practice environments, provisioning Kubernetes clusters using KubeVirt, and facilitating scenario execution and validation. This document outlines the technical design of this service.

## Architecture

The backend follows a clean architecture pattern with clear separation of concerns:

```
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   API Layer   │────▶│ Service Layer │────▶│ Domain Layer  │
└───────────────┘     └───────────────┘     └───────────────┘
        │                     │                     │
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│  Controllers  │     │ Use Cases     │     │ Entities      │
└───────────────┘     └───────────────┘     └───────────────┘
                              │
                              │
                              ▼
                      ┌───────────────┐
                      │ Repository    │
                      │ Interfaces    │
                      └───────────────┘
                              │
                              │
                              ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ K8s Client    │     │ Scenario      │     │ Terminal      │
│ Adapters      │     │ Repository    │     │ Manager       │
└───────────────┘     └───────────────┘     └───────────────┘
```

## Core Components

### 1. Session Management

The Session Manager is responsible for creating and managing user lab sessions.

#### Session Entity
```go
type Session struct {
    ID               string
    Namespace        string
    StartTime        time.Time
    ExpirationTime   time.Time
    Status           SessionStatus
    ControlPlaneVM   string
    WorkerNodeVM     string
    ScenarioID       string
    Tasks            []TaskStatus
    TerminalSessions map[string]string // terminal ID -> pod name mapping
}

type SessionStatus string

const (
    SessionStatusPending   SessionStatus = "pending"
    SessionStatusProvisioning SessionStatus = "provisioning"
    SessionStatusRunning   SessionStatus = "running"
    SessionStatusCompleted SessionStatus = "completed"
    SessionStatusFailed    SessionStatus = "failed"
)

type TaskStatus struct {
    ID             string
    Description    string
    Status         string // "pending", "completed", "failed"
    ValidationTime time.Time
}
```

#### Session Repository Interface
```go
type SessionRepository interface {
    Create(session *Session) error
    Get(id string) (*Session, error)
    Update(session *Session) error
    Delete(id string) error
    List() ([]*Session, error)
}
```

#### Session Use Cases
```go
type SessionService interface {
    CreateSession(scenarioID string) (*Session, error)
    GetSession(id string) (*Session, error)
    DeleteSession(id string) error
    ListSessions() ([]*Session, error)
    ExtendSession(id string, duration time.Duration) error
}
```

### 2. KubeVirt Integration

The KubeVirt integration component handles VM provisioning and management.

#### KubeVirt Service Interface
```go
type KubeVirtService interface {
    ProvisionEnvironment(session *Session, scenarioID string) error
    DestroyEnvironment(session *Session) error
    GetVMStatus(namespace, vmName string) (string, error)
    GetVMIP(namespace, vmName string) (string, error)
    ExecuteCommand(namespace, podName, containerName string, command []string) (string, string, error)
}
```

#### Implementation Details

- Uses KubeVirt Go client library to create VMs from templates
- Manages VM lifecycle with environment variables interpolation
- Monitors VM status and retrieves IP addresses
- Handles VM cleanup and resource reclamation

### 3. Scenario Management

The Scenario Manager handles loading, validating, and tracking scenarios.

#### Scenario Entity
```go
type Scenario struct {
    ID          string
    Title       string
    Description string
    Difficulty  string // "beginner", "intermediate", "advanced"
    TimeEstimate string // e.g., "30m", "1h"
    Topics      []string
    Tasks       []Task
    SetupSteps  []SetupStep
}

type Task struct {
    ID          string
    Title       string
    Description string
    Validation  []ValidationRule
    Hints       []string
}

type ValidationRule struct {
    Type      string // "command", "resource", "config", "custom"
    Target    string // resource name, file path, etc.
    Condition string // validation condition
    Value     string // expected value
}

type SetupStep struct {
    Type    string // "command", "resource", "wait"
    Target  string
    Action  string
    Timeout string // for wait actions
}
```

#### Scenario Repository Interface
```go
type ScenarioRepository interface {
    Get(id string) (*Scenario, error)
    List() ([]*Scenario, error)
    GetCategories() ([]string, error)
}
```

#### Validation Service Interface
```go
type ValidationService interface {
    ValidateTask(session *Session, taskID string) (bool, string, error)
    ValidateAll(session *Session) (map[string]bool, error)
}
```

### 4. Terminal Management

The Terminal Manager handles WebSocket connections to terminal sessions.

#### Terminal Manager Interface
```go
type TerminalManager interface {
    CreateTerminalSession(sessionID, target string) (string, error)
    AttachToTerminal(terminalID string, ws *websocket.Conn) error
    ResizeTerminal(terminalID string, rows, cols uint16) error
    CloseTerminalSession(terminalID string) error
}
```

#### Implementation Details

- WebSocket handling for terminal communication
- PTY creation and management
- Integration with kubectl exec
- Terminal resize handling
- Session cleanup

### 5. API Controllers

The API controllers expose HTTP endpoints for client interaction.

#### Session Controller
```go
// Session API endpoints
POST   /api/v1/sessions              // Create a new session
GET    /api/v1/sessions              // List all sessions
GET    /api/v1/sessions/:id          // Get session details
DELETE /api/v1/sessions/:id          // Delete a session
PUT    /api/v1/sessions/:id/extend   // Extend session duration
```

#### Scenario Controller
```go
// Scenario API endpoints
GET    /api/v1/scenarios             // List all scenarios
GET    /api/v1/scenarios/:id         // Get scenario details
GET    /api/v1/scenarios/categories  // Get scenario categories
```

#### Task Controller
```go
// Task API endpoints
GET    /api/v1/sessions/:id/tasks           // List tasks for a session
GET    /api/v1/sessions/:id/tasks/:taskId   // Get task details
POST   /api/v1/sessions/:id/tasks/:taskId/validate // Validate a task
```

#### Terminal Controller
```go
// Terminal API endpoints
POST   /api/v1/sessions/:id/terminals       // Create a terminal session
GET    /api/v1/terminals/:id/attach         // WebSocket endpoint for terminal
POST   /api/v1/terminals/:id/resize         // Resize terminal
DELETE /api/v1/terminals/:id                // Close terminal session
```

## Configuration

The service will be configured using environment variables with sensible defaults:

```
# Server configuration
SERVER_PORT=8080
SERVER_HOST=0.0.0.0
LOG_LEVEL=info

# Kubernetes configuration
KUBECONFIG_PATH=/etc/killerkoda/kubeconfig
IN_CLUSTER=true

# Session configuration
SESSION_TIMEOUT=60m
SESSION_CLEANUP_INTERVAL=5m
MAX_CONCURRENT_SESSIONS=10

# VM configuration
CONTROL_PLANE_TEMPLATE=templates/control-plane-template.yaml
WORKER_NODE_TEMPLATE=templates/worker-node-template.yaml
CONTROL_PLANE_CONFIG=templates/control-plane-cloud-config.yaml
WORKER_NODE_CONFIG=templates/worker-node-cloud-config.yaml
VM_CPU_CORES=2
VM_MEMORY=2Gi
VM_STORAGE_SIZE=20Gi
VM_STORAGE_CLASS=local-path
```

## Data Persistence

For simplicity, the initial version will use an in-memory repository with Kubernetes ConfigMaps for persistence:

- Session data stored in ConfigMaps in a dedicated namespace
- Scenario definitions stored as YAML files in a ConfigMap
- No external database dependency for initial version

## Security Considerations

- RBAC with dedicated service account for backend
- Network policies to isolate user environments
- Resource quotas to prevent resource exhaustion
- Session timeout and automatic cleanup
- Input validation for all API endpoints
- Secure WebSocket handling for terminal sessions

## Monitoring and Observability

- Prometheus metrics for session count, duration, etc.
- Kubernetes event watchers for VM status changes
- Structured logging with correlation IDs
- Health check endpoints

## Error Handling Strategy

- Consistent error responses with error codes
- Detailed logging for debugging
- Graceful degradation on non-critical errors
- Circuit breakers for external dependencies
- Automatic retry for transient failures