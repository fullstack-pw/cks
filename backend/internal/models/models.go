// internal/models/models.go - Data models for the application

package models

import (
	"time"
)

// Session represents a user session with VMs and associated resources
type Session struct {
	ID               string            `json:"id"`
	Namespace        string            `json:"namespace"`
	ScenarioID       string            `json:"scenarioId"`
	Status           SessionStatus     `json:"status"`
	StatusMessage    string            `json:"statusMessage,omitempty"`
	StartTime        time.Time         `json:"startTime"`
	ExpirationTime   time.Time         `json:"expirationTime"`
	ControlPlaneVM   string            `json:"controlPlaneVM"`
	WorkerNodeVM     string            `json:"workerNodeVM"`
	Tasks            []TaskStatus      `json:"tasks"`
	TerminalSessions map[string]string `json:"terminalSessions"`
}

// SessionStatus represents the status of a session
type SessionStatus string

const (
	// SessionStatusPending indicates the session is being created
	SessionStatusPending SessionStatus = "pending"

	// SessionStatusProvisioning indicates the session is provisioning resources
	SessionStatusProvisioning SessionStatus = "provisioning"

	// SessionStatusRunning indicates the session is active and running
	SessionStatusRunning SessionStatus = "running"

	// SessionStatusCompleted indicates the session has been completed
	SessionStatusCompleted SessionStatus = "completed"

	// SessionStatusFailed indicates the session creation failed
	SessionStatusFailed SessionStatus = "failed"
)

// TaskStatus represents the status of a task in a scenario
type TaskStatus struct {
	ID               string            `json:"id"`
	Status           string            `json:"status"` // "pending", "completed", "failed"
	ValidationTime   time.Time         `json:"validationTime,omitempty"`
	Message          string            `json:"message,omitempty"`
	ValidationResult *ValidationResult `json:"validationResult,omitempty"` // NEW
}

type ValidationResult struct {
	Success   bool               `json:"success"`
	Message   string             `json:"message"`
	Details   []ValidationDetail `json:"details"`
	Timestamp time.Time          `json:"timestamp"`
}

// Scenario represents a CKS practice scenario
type Scenario struct {
	ID           string               `json:"id"`
	Title        string               `json:"title"`
	Description  string               `json:"description"`
	Difficulty   string               `json:"difficulty"` // "beginner", "intermediate", "advanced"
	TimeEstimate string               `json:"timeEstimate"`
	Topics       []string             `json:"topics"`
	Tasks        []Task               `json:"tasks"`
	Requirements ScenarioRequirements `json:"requirements"`
	SetupSteps   []SetupStep          `json:"setupSteps"`
	Author       string               `json:"author,omitempty"`
	Version      string               `json:"version"`
	InitScript   string               `json:"initScript,omitempty"` // Path to init script
}

// ScenarioRequirements defines the requirements for a scenario
type ScenarioRequirements struct {
	K8sVersion string `json:"k8sVersion"`
	Resources  struct {
		CPU    string `json:"cpu"`
		Memory string `json:"memory"`
	} `json:"resources"`
}

// Task represents a task in a scenario
type Task struct {
	ID          string           `json:"id"`
	Title       string           `json:"title"`
	Description string           `json:"description"`
	Validation  []ValidationRule `json:"validation"`
	Hints       []string         `json:"hints,omitempty"`
	Objective   string           `json:"objective,omitempty"` // Add this line
	Steps       []string         `json:"steps,omitempty"`     // Add this line

}

type ValidationRule struct {
	ID           string          `json:"id"`
	Type         string          `json:"type"`
	Description  string          `json:"description,omitempty"`
	Resource     *ResourceTarget `json:"resource,omitempty"`
	Command      *CommandTarget  `json:"command,omitempty"`
	Script       *ScriptTarget   `json:"script,omitempty"`
	File         *FileTarget     `json:"file,omitempty"`
	Condition    string          `json:"condition"`
	Value        interface{}     `json:"value"`
	ErrorMessage string          `json:"errorMessage"`
}

type ResourceTarget struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Property  string `json:"property,omitempty"`
}

type CommandTarget struct {
	Command string `json:"command"`
	Target  string `json:"target"` // "control-plane" or "worker"
}

type ScriptTarget struct {
	Script      string `json:"script"`
	Target      string `json:"target"`
	SuccessCode int    `json:"successCode"`
}

type FileTarget struct {
	Path   string `json:"path"`
	Target string `json:"target"`
}
type SetupStep struct {
	ID          string           `json:"id"`
	Type        string           `json:"type"`   // "command", "resource", "script", "wait"
	Target      string           `json:"target"` // "control-plane", "worker", "both"
	Description string           `json:"description"`
	Command     string           `json:"command,omitempty"`
	Script      string           `json:"script,omitempty"`
	Resource    string           `json:"resource,omitempty"` // YAML content
	Timeout     time.Duration    `json:"timeout"`
	RetryCount  int              `json:"retryCount"`
	Conditions  []SetupCondition `json:"conditions,omitempty"`
}

// TerminalSession represents a terminal session for a VM
type TerminalSession struct {
	ID         string    `json:"id"`
	SessionID  string    `json:"sessionId"`
	Target     string    `json:"target"` // "control-plane" or "worker-node"
	Status     string    `json:"status"` // "connected", "disconnected"
	CreateTime time.Time `json:"createTime"`
}

// ValidationRequest represents a request to validate a task
type ValidationRequest struct {
	SessionID string `json:"sessionId"`
	TaskID    string `json:"taskId"`
}

// ValidationResponse represents a response from task validation
type ValidationResponse struct {
	Success bool               `json:"success"`
	Message string             `json:"message"`
	Details []ValidationDetail `json:"details,omitempty"`
}

// ValidationDetail represents detailed validation results
type ValidationDetail struct {
	Rule         string      `json:"rule"`
	Passed       bool        `json:"passed"`
	Message      string      `json:"message,omitempty"`
	Expected     interface{} `json:"expected,omitempty"`
	Actual       interface{} `json:"actual,omitempty"`
	Description  string      `json:"description,omitempty"`
	Type         string      `json:"type,omitempty"`
	ErrorDetails string      `json:"errorDetails,omitempty"`
}

// CreateSessionRequest represents a request to create a new session
type CreateSessionRequest struct {
	ScenarioID string `json:"scenarioId"`
}

// CreateSessionResponse represents a response to a create session request
type CreateSessionResponse struct {
	SessionID string `json:"sessionId"`
	Status    string `json:"status"`
}

// CreateTerminalRequest represents a request to create a terminal session
type CreateTerminalRequest struct {
	SessionID string `json:"sessionId"`
	Target    string `json:"target"`
}

// CreateTerminalResponse represents a response to a create terminal request
type CreateTerminalResponse struct {
	TerminalID string `json:"terminalId"`
}

// ResizeTerminalRequest represents a request to resize a terminal
type ResizeTerminalRequest struct {
	Rows uint16 `json:"rows"`
	Cols uint16 `json:"cols"`
}

type SetupCondition struct {
	Type     string        `json:"type"` // "resource_exists", "command_success", "pod_ready"
	Resource string        `json:"resource,omitempty"`
	Command  string        `json:"command,omitempty"`
	Timeout  time.Duration `json:"timeout"`
}
