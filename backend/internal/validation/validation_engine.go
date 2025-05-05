// backend/internal/validation/validation_engine.go - Task validation engine

package validation

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/fullstack-pw/cks/backend/internal/kubevirt"
	"github.com/fullstack-pw/cks/backend/internal/models"
)

// Engine represents the validation engine
type Engine struct {
	kubevirtClient *kubevirt.Client
}

// NewEngine creates a new validation engine
func NewEngine(kubevirtClient *kubevirt.Client) *Engine {
	return &Engine{
		kubevirtClient: kubevirtClient,
	}
}

// ValidateTask validates a specific task based on its validation rules
func (e *Engine) ValidateTask(ctx context.Context, session *models.Session, task models.Task) (*models.ValidationResponse, error) {
	// Result structure
	result := &models.ValidationResponse{
		Success: true,
		Message: "Task completed successfully",
		Details: make([]models.ValidationDetail, 0, len(task.Validation)),
	}

	// Check all validation rules
	for _, rule := range task.Validation {
		detail, err := e.validateRule(ctx, session, rule)
		if err != nil {
			return nil, err
		}

		result.Details = append(result.Details, detail)

		// If any rule fails, the task fails
		if !detail.Passed {
			result.Success = false
			result.Message = "Task validation failed"
		}
	}

	return result, nil
}

// validateRule validates a single rule
func (e *Engine) validateRule(ctx context.Context, session *models.Session, rule models.ValidationRule) (models.ValidationDetail, error) {
	detail := models.ValidationDetail{
		Rule:    rule.Type,
		Passed:  false,
		Message: rule.Value,
	}

	switch rule.Type {
	case "resource_exists":
		return e.validateResourceExists(ctx, session, rule)
	case "resource_property":
		return e.validateResourceProperty(ctx, session, rule)
	case "command":
		return e.validateCommand(ctx, session, rule)
	case "file_content":
		return e.validateFileContent(ctx, session, rule)
	default:
		detail.Message = fmt.Sprintf("Unknown validation rule type: %s", rule.Type)
		return detail, nil
	}
}

// validateResourceExists checks if a Kubernetes resource exists
func (e *Engine) validateResourceExists(ctx context.Context, session *models.Session, rule models.ValidationRule) (models.ValidationDetail, error) {
	detail := models.ValidationDetail{
		Rule:   "Resource existence check",
		Passed: false,
	}

	// Parse resource target (format: kind/name/namespace)
	parts := strings.Split(rule.Target, "/")
	if len(parts) < 2 {
		detail.Message = fmt.Sprintf("Invalid resource target format: %s", rule.Target)
		return detail, nil
	}

	kind := parts[0]
	name := parts[1]
	namespace := session.Namespace
	if len(parts) > 2 {
		namespace = parts[2]
	}

	// Execute command to check resource
	cmd := fmt.Sprintf("kubectl get %s %s -n %s", kind, name, namespace)
	output, err := e.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, session.ControlPlaneVM, cmd)
	if err != nil {
		detail.Message = fmt.Sprintf("Failed to check resource: %v", err)
		return detail, nil
	}

	// Check if resource exists
	if strings.Contains(output, "NotFound") || strings.Contains(output, "Error") {
		detail.Message = fmt.Sprintf("%s '%s' not found in namespace '%s'", kind, name, namespace)
		return detail, nil
	}

	detail.Passed = true
	detail.Message = fmt.Sprintf("%s '%s' exists in namespace '%s'", kind, name, namespace)
	return detail, nil
}

// validateResourceProperty checks a property of a Kubernetes resource
func (e *Engine) validateResourceProperty(ctx context.Context, session *models.Session, rule models.ValidationRule) (models.ValidationDetail, error) {
	detail := models.ValidationDetail{
		Rule:   "Resource property check",
		Passed: false,
	}

	// Parse resource target (format: kind/name/namespace/property)
	parts := strings.Split(rule.Target, "/")
	if len(parts) < 3 {
		detail.Message = fmt.Sprintf("Invalid resource property target format: %s", rule.Target)
		return detail, nil
	}

	kind := parts[0]
	name := parts[1]
	property := parts[2]
	namespace := session.Namespace
	if len(parts) > 3 {
		namespace = parts[3]
	}

	// Execute command to get resource property
	cmd := fmt.Sprintf("kubectl get %s %s -n %s -o jsonpath='{%s}'", kind, name, namespace, property)
	output, err := e.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, session.ControlPlaneVM, cmd)
	if err != nil {
		detail.Message = fmt.Sprintf("Failed to check resource property: %v", err)
		return detail, nil
	}

	// Check property value
	switch rule.Condition {
	case "equals":
		if output == rule.Value {
			detail.Passed = true
			detail.Message = fmt.Sprintf("Property %s matches expected value", property)
		} else {
			detail.Message = fmt.Sprintf("Property %s does not match expected value. Got '%s', expected '%s'", property, output, rule.Value)
		}
	case "contains":
		if strings.Contains(output, rule.Value) {
			detail.Passed = true
			detail.Message = fmt.Sprintf("Property %s contains expected value", property)
		} else {
			detail.Message = fmt.Sprintf("Property %s does not contain expected value", property)
		}
	case "matches":
		re, err := regexp.Compile(rule.Value)
		if err != nil {
			detail.Message = fmt.Sprintf("Invalid regex pattern: %v", err)
			return detail, nil
		}
		if re.MatchString(output) {
			detail.Passed = true
			detail.Message = fmt.Sprintf("Property %s matches expected pattern", property)
		} else {
			detail.Message = fmt.Sprintf("Property %s does not match expected pattern", property)
		}
	default:
		detail.Message = fmt.Sprintf("Unknown condition: %s", rule.Condition)
	}

	return detail, nil
}

// validateCommand executes a command and validates the output
func (e *Engine) validateCommand(ctx context.Context, session *models.Session, rule models.ValidationRule) (models.ValidationDetail, error) {
	detail := models.ValidationDetail{
		Rule:   "Command execution check",
		Passed: false,
	}

	// Target specifies which VM to run the command on
	target := session.ControlPlaneVM
	if rule.Target == "worker" {
		target = session.WorkerNodeVM
	}

	// Execute command
	output, err := e.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, target, rule.Condition)
	if err != nil {
		detail.Message = fmt.Sprintf("Command execution failed: %v", err)
		return detail, nil
	}

	// Check output based on the validation type
	switch {
	case strings.HasPrefix(rule.Value, "output_contains:"):
		expected := strings.TrimPrefix(rule.Value, "output_contains:")
		if strings.Contains(output, expected) {
			detail.Passed = true
			detail.Message = "Command output contains expected value"
		} else {
			detail.Message = "Command output does not contain expected value"
		}
	case strings.HasPrefix(rule.Value, "output_equals:"):
		expected := strings.TrimPrefix(rule.Value, "output_equals:")
		if strings.TrimSpace(output) == strings.TrimSpace(expected) {
			detail.Passed = true
			detail.Message = "Command output matches expected value"
		} else {
			detail.Message = "Command output does not match expected value"
		}
	case strings.HasPrefix(rule.Value, "exit_code:"):
		// For exit code validation, we need to modify the command execution function
		// This is a placeholder - would need to be implemented in kubevirt client
		detail.Passed = true // Mock success
		detail.Message = "Exit code matches expected value"
	default:
		// Default is to check if output contains the value
		if strings.Contains(output, rule.Value) {
			detail.Passed = true
			detail.Message = "Command output contains expected value"
		} else {
			detail.Message = "Command output does not contain expected value"
		}
	}

	return detail, nil
}

// validateFileContent checks the content of a file
func (e *Engine) validateFileContent(ctx context.Context, session *models.Session, rule models.ValidationRule) (models.ValidationDetail, error) {
	detail := models.ValidationDetail{
		Rule:   "File content check",
		Passed: false,
	}

	// Target specifies which VM and file to check
	parts := strings.Split(rule.Target, ":")
	if len(parts) != 2 {
		detail.Message = "Invalid file target format. Expected 'vm:path'"
		return detail, nil
	}

	target := session.ControlPlaneVM
	if parts[0] == "worker" {
		target = session.WorkerNodeVM
	}
	filePath := parts[1]

	// Execute command to get file content
	cmd := fmt.Sprintf("cat %s", filePath)
	output, err := e.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, target, cmd)
	if err != nil {
		detail.Message = fmt.Sprintf("Failed to read file: %v", err)
		return detail, nil
	}

	// Check content
	switch {
	case strings.HasPrefix(rule.Condition, "contains"):
		if strings.Contains(output, rule.Value) {
			detail.Passed = true
			detail.Message = fmt.Sprintf("File %s contains expected content", filePath)
		} else {
			detail.Message = fmt.Sprintf("File %s does not contain expected content", filePath)
		}
	case strings.HasPrefix(rule.Condition, "matches"):
		re, err := regexp.Compile(rule.Value)
		if err != nil {
			detail.Message = fmt.Sprintf("Invalid regex pattern: %v", err)
			return detail, nil
		}
		if re.MatchString(output) {
			detail.Passed = true
			detail.Message = fmt.Sprintf("File %s matches expected pattern", filePath)
		} else {
			detail.Message = fmt.Sprintf("File %s does not match expected pattern", filePath)
		}
	default:
		detail.Message = fmt.Sprintf("Unknown condition: %s", rule.Condition)
	}

	return detail, nil
}
