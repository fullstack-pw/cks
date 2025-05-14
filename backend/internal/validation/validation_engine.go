package validation

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/fullstack-pw/cks/backend/internal/kubevirt"
	"github.com/fullstack-pw/cks/backend/internal/models"
	"github.com/sirupsen/logrus"
)

type Engine struct {
	kubevirtClient *kubevirt.Client
}

func NewEngine(kubevirtClient *kubevirt.Client) *Engine {
	return &Engine{
		kubevirtClient: kubevirtClient,
	}
}

func (e *Engine) ValidateTask(ctx context.Context, session *models.Session, task models.Task) (*models.ValidationResponse, error) {
	result := &models.ValidationResponse{
		Success: true,
		Message: "All validations passed",
		Details: []models.ValidationDetail{},
	}

	for _, rule := range task.Validation {
		detail, err := e.validateRule(ctx, session, rule)
		if err != nil {
			return nil, fmt.Errorf("validation error for rule %s: %w", rule.ID, err)
		}

		result.Details = append(result.Details, detail)

		if !detail.Passed {
			result.Success = false
			result.Message = "One or more validations failed"
		}
	}

	return result, nil
}

// In backend/internal/validation/validation_engine.go, update the validateRule method:

func (e *Engine) validateRule(ctx context.Context, session *models.Session, rule models.ValidationRule) (models.ValidationDetail, error) {
	detail := models.ValidationDetail{
		Rule:    rule.ID,
		Passed:  false,
		Message: rule.ErrorMessage,
	}

	var err error

	// Add logging to track rule execution
	logrus.WithFields(logrus.Fields{
		"ruleID":   rule.ID,
		"ruleType": rule.Type,
		"resource": rule.Resource,
		"command":  rule.Command,
		"script":   rule.Script,
	}).Debug("Starting validation rule execution")

	switch rule.Type {
	case "resource_exists":
		detail, err = e.validateResourceExists(ctx, session, rule)
	case "resource_property":
		detail, err = e.validateResourceProperty(ctx, session, rule)
	case "command":
		detail, err = e.validateCommand(ctx, session, rule)
	case "script":
		detail, err = e.validateScript(ctx, session, rule)
	case "file_exists":
		detail, err = e.validateFileExists(ctx, session, rule)
	case "file_content":
		detail, err = e.validateFileContent(ctx, session, rule)
	default:
		detail.Message = fmt.Sprintf("Unknown validation type: %s", rule.Type)
	}

	// Log the result
	logrus.WithFields(logrus.Fields{
		"ruleID":  rule.ID,
		"passed":  detail.Passed,
		"message": detail.Message,
		"error":   err,
	}).Debug("Validation rule completed")

	return detail, err
}

func (e *Engine) validateResourceExists(ctx context.Context, session *models.Session, rule models.ValidationRule) (models.ValidationDetail, error) {
	logrus.WithFields(logrus.Fields{
		"ruleID":  rule.ID,
		"session": session.ID,
		"rule":    fmt.Sprintf("%+v", rule),
	}).Debug("Starting validateResourceExists")

	detail := models.ValidationDetail{
		Rule:   rule.ID,
		Passed: false,
	}

	if rule.Resource == nil {
		detail.Message = "Invalid resource specification"
		logrus.WithField("ruleID", rule.ID).Debug("Resource is nil")
		return detail, nil
	}

	// Build kubectl command
	namespace := rule.Resource.Namespace
	if namespace == "" {
		namespace = "default"
	}

	cmd := fmt.Sprintf("kubectl get %s %s -n %s",
		strings.ToLower(rule.Resource.Kind),
		rule.Resource.Name,
		namespace)

	logrus.WithFields(logrus.Fields{
		"command":   cmd,
		"namespace": session.Namespace,
		"targetVM":  session.ControlPlaneVM,
	}).Debug("Executing kubectl command")

	output, err := e.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, session.ControlPlaneVM, cmd)

	logrus.WithFields(logrus.Fields{
		"output": output,
		"error":  err,
	}).Debug("Command execution result")

	if err != nil || strings.Contains(output, "NotFound") || strings.Contains(output, "Error") {
		detail.Message = rule.ErrorMessage
		logrus.WithFields(logrus.Fields{
			"ruleID":  rule.ID,
			"message": detail.Message,
		}).Debug("Resource check failed")
		return detail, nil
	}

	detail.Passed = true
	detail.Message = fmt.Sprintf("%s '%s' exists in namespace '%s'",
		rule.Resource.Kind, rule.Resource.Name, namespace)

	logrus.WithFields(logrus.Fields{
		"ruleID":  rule.ID,
		"passed":  detail.Passed,
		"message": detail.Message,
	}).Debug("Resource check passed")

	return detail, nil
}

func (e *Engine) validateResourceProperty(ctx context.Context, session *models.Session, rule models.ValidationRule) (models.ValidationDetail, error) {
	detail := models.ValidationDetail{
		Rule:   rule.ID,
		Passed: false,
	}

	if rule.Resource == nil || rule.Resource.Property == "" {
		detail.Message = "Invalid resource property specification"
		return detail, nil
	}

	namespace := rule.Resource.Namespace
	if namespace == "" {
		namespace = "default"
	}

	// Get the property value
	cmd := fmt.Sprintf("kubectl get %s %s -n %s -o jsonpath='{%s}'",
		strings.ToLower(rule.Resource.Kind),
		rule.Resource.Name,
		namespace,
		rule.Resource.Property)

	output, err := e.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, session.ControlPlaneVM, cmd)
	if err != nil {
		detail.Message = fmt.Sprintf("Failed to get property: %v", err)
		return detail, nil
	}

	output = strings.TrimSpace(output)

	// Check the condition
	passed := false
	switch rule.Condition {
	case "equals":
		expectedValue := fmt.Sprintf("%v", rule.Value)
		passed = output == expectedValue
		if !passed {
			detail.Message = fmt.Sprintf("%s: expected '%s', got '%s'", rule.ErrorMessage, expectedValue, output)
		}

	case "contains":
		expectedValue := fmt.Sprintf("%v", rule.Value)
		passed = strings.Contains(output, expectedValue)
		if !passed {
			detail.Message = fmt.Sprintf("%s: output does not contain '%s'", rule.ErrorMessage, expectedValue)
		}

	case "matches":
		pattern := fmt.Sprintf("%v", rule.Value)
		re, err := regexp.Compile(pattern)
		if err != nil {
			detail.Message = fmt.Sprintf("Invalid regex pattern: %v", err)
			return detail, nil
		}
		passed = re.MatchString(output)
		if !passed {
			detail.Message = fmt.Sprintf("%s: output does not match pattern '%s'", rule.ErrorMessage, pattern)
		}

	case "greater_than", "less_than", "equals_numeric":
		// Handle numeric comparisons
		outputNum, err1 := strconv.ParseFloat(output, 64)
		expectedNum, err2 := strconv.ParseFloat(fmt.Sprintf("%v", rule.Value), 64)

		if err1 != nil || err2 != nil {
			detail.Message = "Failed to parse numeric values"
			return detail, nil
		}

		switch rule.Condition {
		case "greater_than":
			passed = outputNum > expectedNum
		case "less_than":
			passed = outputNum < expectedNum
		case "equals_numeric":
			passed = outputNum == expectedNum
		}

		if !passed {
			detail.Message = fmt.Sprintf("%s: got %f, expected %s %f",
				rule.ErrorMessage, outputNum, rule.Condition, expectedNum)
		}

	default:
		detail.Message = fmt.Sprintf("Unknown condition: %s", rule.Condition)
		return detail, nil
	}

	if passed {
		detail.Passed = true
		detail.Message = fmt.Sprintf("Property %s matches expected condition", rule.Resource.Property)
	}

	return detail, nil
}

func (e *Engine) validateScript(ctx context.Context, session *models.Session, rule models.ValidationRule) (models.ValidationDetail, error) {
	detail := models.ValidationDetail{
		Rule:   rule.ID,
		Passed: false,
	}

	if rule.Script == nil {
		detail.Message = "Invalid script specification"
		return detail, nil
	}

	// Determine target VM
	target := session.ControlPlaneVM
	if rule.Script.Target == "worker" {
		target = session.WorkerNodeVM
	}

	// Create a temporary script file
	scriptFile := fmt.Sprintf("/tmp/validation-%s-%s.sh", session.ID, rule.ID)

	// Write script to file
	cmd := fmt.Sprintf("cat > %s << 'EOF'\n%s\nEOF && chmod +x %s", scriptFile, rule.Script.Script, scriptFile)
	_, err := e.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, target, cmd)
	if err != nil {
		detail.Message = fmt.Sprintf("Failed to create script: %v", err)
		return detail, nil
	}

	// Execute script and check exit code
	scriptCmd := fmt.Sprintf("%s; echo $?", scriptFile)
	output, err := e.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, target, scriptCmd)

	// Cleanup
	e.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, target, fmt.Sprintf("rm %s", scriptFile))

	if err != nil {
		detail.Message = fmt.Sprintf("%s: command execution failed: %v", rule.ErrorMessage, err)
		return detail, nil
	}

	// Extract exit code from output
	lines := strings.Split(strings.TrimSpace(output), "\n")
	if len(lines) == 0 {
		detail.Message = "Failed to get script exit code"
		return detail, nil
	}

	exitCodeStr := lines[len(lines)-1]
	exitCode, err := strconv.Atoi(exitCodeStr)
	if err != nil {
		detail.Message = fmt.Sprintf("Failed to parse exit code: %v", err)
		return detail, nil
	}

	// Check if exit code matches expected
	expectedCode := 0
	if rule.Script.SuccessCode != 0 {
		expectedCode = rule.Script.SuccessCode
	}

	if exitCode == expectedCode {
		detail.Passed = true
		detail.Message = "Script validation passed"
	} else {
		detail.Message = fmt.Sprintf("%s: exit code %d, expected %d", rule.ErrorMessage, exitCode, expectedCode)
	}

	return detail, nil
}

func (e *Engine) validateCommand(ctx context.Context, session *models.Session, rule models.ValidationRule) (models.ValidationDetail, error) {
	logrus.WithFields(logrus.Fields{
		"ruleID":  rule.ID,
		"command": rule.Command,
	}).Debug("Starting validateCommand")

	detail := models.ValidationDetail{
		Rule:   rule.ID,
		Passed: false,
	}

	if rule.Command == nil {
		detail.Message = "Invalid command specification"
		logrus.WithField("ruleID", rule.ID).Debug("Command is nil")
		return detail, nil
	}

	// Determine target VM
	target := session.ControlPlaneVM
	if rule.Command.Target == "worker" {
		target = session.WorkerNodeVM
	}

	logrus.WithFields(logrus.Fields{
		"target":    target,
		"command":   rule.Command.Command,
		"sessionNS": session.Namespace,
	}).Debug("Executing command on target VM")

	// Execute command
	output, err := e.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, target, rule.Command.Command)

	logrus.WithFields(logrus.Fields{
		"output": output,
		"error":  err,
		"ruleID": rule.ID,
	}).Debug("Command execution completed")

	// Check condition
	switch rule.Condition {
	case "success":
		if err == nil {
			detail.Passed = true
			detail.Message = "Command executed successfully"
		} else {
			detail.Message = fmt.Sprintf("%s: %v", rule.ErrorMessage, err)
		}

	case "output_equals":
		expectedOutput := fmt.Sprintf("%v", rule.Value)
		actualOutput := strings.TrimSpace(output)
		logrus.WithFields(logrus.Fields{
			"expected": expectedOutput,
			"actual":   actualOutput,
		}).Debug("Comparing output")

		if err == nil && actualOutput == strings.TrimSpace(expectedOutput) {
			detail.Passed = true
			detail.Message = "Command output matches expected value"
		} else {
			detail.Message = fmt.Sprintf("%s: expected '%s', got '%s'", rule.ErrorMessage, expectedOutput, actualOutput)
		}

	case "output_contains":
		expectedValue := fmt.Sprintf("%v", rule.Value)
		if err == nil && strings.Contains(output, expectedValue) {
			detail.Passed = true
			detail.Message = "Command output contains expected value"
		} else {
			detail.Message = fmt.Sprintf("%s: output does not contain '%s'", rule.ErrorMessage, expectedValue)
		}

	default:
		detail.Message = fmt.Sprintf("Unknown condition: %s", rule.Condition)
	}

	logrus.WithFields(logrus.Fields{
		"ruleID":  rule.ID,
		"passed":  detail.Passed,
		"message": detail.Message,
	}).Debug("Command validation completed")

	return detail, nil
}

func (e *Engine) validateFileExists(ctx context.Context, session *models.Session, rule models.ValidationRule) (models.ValidationDetail, error) {
	detail := models.ValidationDetail{
		Rule:   rule.ID,
		Passed: false,
	}

	if rule.File == nil {
		detail.Message = "Invalid file specification"
		return detail, nil
	}

	// Determine target VM
	target := session.ControlPlaneVM
	if rule.File.Target == "worker" {
		target = session.WorkerNodeVM
	}

	// Check if file exists
	cmd := fmt.Sprintf("test -f %s", rule.File.Path)
	_, err := e.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, target, cmd)

	if err == nil {
		detail.Passed = true
		detail.Message = fmt.Sprintf("File %s exists", rule.File.Path)
	} else {
		detail.Message = fmt.Sprintf("%s: %s", rule.ErrorMessage, rule.File.Path)
	}

	return detail, nil
}

func (e *Engine) validateFileContent(ctx context.Context, session *models.Session, rule models.ValidationRule) (models.ValidationDetail, error) {
	detail := models.ValidationDetail{
		Rule:   rule.ID,
		Passed: false,
	}

	if rule.File == nil {
		detail.Message = "Invalid file specification"
		return detail, nil
	}

	// Determine target VM
	target := session.ControlPlaneVM
	if rule.File.Target == "worker" {
		target = session.WorkerNodeVM
	}

	// Get file content
	cmd := fmt.Sprintf("cat %s", rule.File.Path)
	output, err := e.kubevirtClient.ExecuteCommandInVM(ctx, session.Namespace, target, cmd)

	if err != nil {
		detail.Message = fmt.Sprintf("Failed to read file: %v", err)
		return detail, nil
	}

	// Check condition
	switch rule.Condition {
	case "contains":
		expectedValue := fmt.Sprintf("%v", rule.Value)
		if strings.Contains(output, expectedValue) {
			detail.Passed = true
			detail.Message = fmt.Sprintf("File contains expected content")
		} else {
			detail.Message = fmt.Sprintf("%s: file does not contain '%s'", rule.ErrorMessage, expectedValue)
		}

	case "matches":
		pattern := fmt.Sprintf("%v", rule.Value)
		re, err := regexp.Compile(pattern)
		if err != nil {
			detail.Message = fmt.Sprintf("Invalid regex pattern: %v", err)
			return detail, nil
		}

		if re.MatchString(output) {
			detail.Passed = true
			detail.Message = "File content matches pattern"
		} else {
			detail.Message = fmt.Sprintf("%s: content does not match pattern", rule.ErrorMessage)
		}

	default:
		detail.Message = fmt.Sprintf("Unknown condition: %s", rule.Condition)
	}

	return detail, nil
}
