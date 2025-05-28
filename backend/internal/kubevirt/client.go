package kubevirt

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"kubevirt.io/client-go/kubecli"

	"github.com/fullstack-pw/cks/backend/internal/config"
	"github.com/sirupsen/logrus"
	snapshotv1beta1 "kubevirt.io/api/snapshot/v1beta1"
)

// Client represents a KubeVirt client for managing VMs
type Client struct {
	kubeClient    kubernetes.Interface
	virtClient    kubecli.KubevirtClient
	config        *config.Config
	restConfig    *rest.Config // Store the REST config
	templateCache map[string]*template.Template
}

// Retry configuration constants
const (
	DefaultMaxRetries   = 3
	DefaultRetryDelay   = 10 * time.Second
	DefaultRetryBackoff = 2.0
	VMReadyTimeout      = 15 * time.Minute
	VMCreationTimeout   = 10 * time.Minute
)

// RetryConfig holds retry configuration
type RetryConfig struct {
	MaxRetries int
	Delay      time.Duration
	Backoff    float64
}

// getDefaultRetryConfig returns default retry configuration
func getDefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries: DefaultMaxRetries,
		Delay:      DefaultRetryDelay,
		Backoff:    DefaultRetryBackoff,
	}
}

// retryOperation executes an operation with exponential backoff retry
func (c *Client) retryOperation(ctx context.Context, operationName string, operation func() error) error {
	config := getDefaultRetryConfig()
	var lastErr error

	for attempt := 0; attempt <= config.MaxRetries; attempt++ {
		if attempt > 0 {
			delay := time.Duration(float64(config.Delay) * math.Pow(config.Backoff, float64(attempt-1)))
			logrus.WithFields(logrus.Fields{
				"operation": operationName,
				"attempt":   attempt,
				"delay":     delay,
			}).Warn("Retrying operation after failure")

			select {
			case <-ctx.Done():
				return fmt.Errorf("operation cancelled: %w", ctx.Err())
			case <-time.After(delay):
				// Continue with retry
			}
		}

		err := operation()
		if err == nil {
			if attempt > 0 {
				logrus.WithFields(logrus.Fields{
					"operation": operationName,
					"attempt":   attempt,
				}).Info("Operation succeeded after retry")
			}
			return nil
		}

		lastErr = err
		logrus.WithError(err).WithFields(logrus.Fields{
			"operation": operationName,
			"attempt":   attempt,
		}).Warn("Operation failed")

		// Don't retry on context cancellation
		if ctx.Err() != nil {
			return fmt.Errorf("operation cancelled: %w", ctx.Err())
		}
	}

	return fmt.Errorf("operation %s failed after %d attempts: %w", operationName, config.MaxRetries+1, lastErr)
}

// NewClient creates a new KubeVirt client
func NewClient(restConfig *rest.Config) (*Client, error) {
	// Create kubernetes client
	kubeClient, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create kubernetes client: %v", err)
	}

	// Create kubevirt client
	virtClient, err := kubecli.GetKubevirtClientFromRESTConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create kubevirt client: %v", err)
	}

	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %v", err)
	}

	// Create and cache templates
	templateCache, err := loadTemplates(cfg.TemplatePath)
	if err != nil {
		return nil, fmt.Errorf("failed to load templates: %v", err)
	}

	// Test the KubeVirt client connection
	_, err = virtClient.VirtualMachine("default").List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to KubeVirt API: %v", err)
	}

	return &Client{
		kubeClient:    kubeClient,
		virtClient:    virtClient,
		config:        cfg,
		restConfig:    restConfig, // Store the REST config
		templateCache: templateCache,
	}, nil
}

// validateGoldenImage checks if the golden image PVC exists
func (c *Client) validateGoldenImage(ctx context.Context) error {
	if !c.config.ValidateGoldenImage {
		return nil // Skip validation if disabled
	}

	logrus.WithFields(logrus.Fields{
		"imageName":      c.config.GoldenImageName,
		"imageNamespace": c.config.GoldenImageNamespace,
	}).Info("Validating golden image exists")

	// Check if the PVC exists
	_, err := c.kubeClient.CoreV1().PersistentVolumeClaims(c.config.GoldenImageNamespace).Get(
		ctx,
		c.config.GoldenImageName,
		metav1.GetOptions{},
	)

	if err != nil {
		return fmt.Errorf("golden image PVC '%s' not found in namespace '%s': %w",
			c.config.GoldenImageName,
			c.config.GoldenImageNamespace,
			err)
	}

	logrus.WithField("imageName", c.config.GoldenImageName).Info("Golden image validation successful")
	return nil
}

func (c *Client) CreateCluster(ctx context.Context, namespace, controlPlaneName, workerNodeName string) error {
	// Validate golden image exists before proceeding
	err := c.validateGoldenImage(ctx)
	if err != nil {
		return fmt.Errorf("golden image validation failed: %w", err)
	}

	logrus.WithFields(logrus.Fields{
		"namespace":    namespace,
		"controlPlane": controlPlaneName,
		"workerNode":   workerNodeName,
	}).Info("Starting VM cluster creation with enhanced error handling")

	// Step 1: Create control plane cloud-init secret with retry
	err = c.retryOperation(ctx, "create-control-plane-secret", func() error {
		return c.createCloudInitSecret(ctx, namespace, controlPlaneName, "control-plane")
	})
	if err != nil {
		return fmt.Errorf("failed to create control plane cloud-init secret: %w", err)
	}
	logrus.Info("Control plane cloud-init secret created successfully")

	// Step 2: Create control plane VM with retry
	err = c.retryOperation(ctx, "create-control-plane-vm", func() error {
		return c.createVM(ctx, namespace, controlPlaneName, "control-plane")
	})
	if err != nil {
		return fmt.Errorf("failed to create control plane VM: %w", err)
	}
	logrus.Info("Control plane VM created successfully")

	// Step 3: Wait for control plane to be ready with timeout
	controlPlaneCtx, cancelCP := context.WithTimeout(ctx, VMReadyTimeout)
	defer cancelCP()

	err = c.WaitForVMReady(controlPlaneCtx, namespace, controlPlaneName)
	if err != nil {
		// Try to cleanup on failure
		cleanupErr := c.cleanupFailedVM(ctx, namespace, controlPlaneName)
		if cleanupErr != nil {
			logrus.WithError(cleanupErr).Error("Failed to cleanup control plane VM after creation failure")
		}
		return fmt.Errorf("control plane VM failed to become ready: %w", err)
	}
	logrus.Info("Control plane VM is ready")

	// Step 4: Get join command with retry
	var joinCommand string
	err = c.retryOperation(ctx, "get-join-command", func() error {
		var cmdErr error
		joinCommand, cmdErr = c.getJoinCommand(ctx, namespace, controlPlaneName)
		return cmdErr
	})
	if err != nil {
		return fmt.Errorf("failed to get join command: %w", err)
	}

	// Step 5: Create worker node cloud-init secret with join command
	err = c.retryOperation(ctx, "create-worker-secret", func() error {
		return c.createCloudInitSecret(ctx, namespace, workerNodeName, "worker", map[string]string{
			"JOIN_COMMAND":           joinCommand,
			"JOIN":                   joinCommand,
			"CONTROL_PLANE_ENDPOINT": fmt.Sprintf("%s.%s.pod.cluster.local", strings.ReplaceAll(c.getVMIP(ctx, namespace, controlPlaneName), ".", "-"), namespace),
			"CONTROL_PLANE_IP":       c.getVMIP(ctx, namespace, controlPlaneName),
			"CONTROL_PLANE_VM_NAME":  controlPlaneName,
		})
	})
	if err != nil {
		return fmt.Errorf("failed to create worker node cloud-init secret: %w", err)
	}

	// Step 6: Create worker node VM with retry
	err = c.retryOperation(ctx, "create-worker-vm", func() error {
		return c.createVM(ctx, namespace, workerNodeName, "worker")
	})
	if err != nil {
		return fmt.Errorf("failed to create worker node VM: %w", err)
	}

	logrus.WithFields(logrus.Fields{
		"namespace":    namespace,
		"controlPlane": controlPlaneName,
		"workerNode":   workerNodeName,
	}).Info("VM cluster creation completed successfully")

	return nil
}

// cleanupFailedVM cleans up a failed VM and its resources
func (c *Client) cleanupFailedVM(ctx context.Context, namespace, vmName string) error {
	logrus.WithFields(logrus.Fields{
		"namespace": namespace,
		"vmName":    vmName,
	}).Info("Cleaning up failed VM")

	var errors []error

	// Delete VM (ignore not found errors)
	err := c.virtClient.VirtualMachine(namespace).Delete(ctx, vmName, metav1.DeleteOptions{})
	if err != nil && !k8serrors.IsNotFound(err) {
		errors = append(errors, fmt.Errorf("failed to delete VM %s: %w", vmName, err))
	}

	// Delete DataVolume
	dvName := fmt.Sprintf("%s-rootdisk", vmName)
	err = c.virtClient.CdiClient().CdiV1beta1().DataVolumes(namespace).Delete(ctx, dvName, metav1.DeleteOptions{})
	if err != nil && !k8serrors.IsNotFound(err) {
		errors = append(errors, fmt.Errorf("failed to delete DataVolume %s: %w", dvName, err))
	}

	// Delete cloud-init secret
	err = c.kubeClient.CoreV1().Secrets(namespace).Delete(ctx, vmName, metav1.DeleteOptions{})
	if err != nil && !k8serrors.IsNotFound(err) {
		errors = append(errors, fmt.Errorf("failed to delete Secret %s: %w", vmName, err))
	}

	if len(errors) > 0 {
		var errorMsgs []string
		for _, e := range errors {
			errorMsgs = append(errorMsgs, e.Error())
		}
		return fmt.Errorf("cleanup errors: %s", strings.Join(errorMsgs, "; "))
	}

	logrus.WithField("vmName", vmName).Info("VM cleanup completed successfully")
	return nil
}

func (c *Client) createCloudInitSecret(ctx context.Context, namespace, vmName, vmType string, extraVars ...map[string]string) error {
	// Load cloud-init template
	var templateName string
	if vmType == "control-plane" {
		templateName = "control-plane-cloud-config.yaml"
	} else {
		templateName = "worker-node-cloud-config.yaml"
	}

	// Create data map for template
	data := map[string]string{
		"CONTROL_PLANE_VM_NAME": fmt.Sprintf("cks-control-plane-%s", namespace),
		"WORKER_VM_NAME":        fmt.Sprintf("cks-worker-node-%s", namespace),
		"SESSION_NAMESPACE":     namespace,
		"SESSION_ID":            strings.TrimPrefix(namespace, "user-session-"),
		"K8S_VERSION":           c.config.KubernetesVersion,
		"POD_CIDR":              c.config.PodCIDR,
	}

	// Add extra variables if provided
	if len(extraVars) > 0 {
		for k, v := range extraVars[0] {
			data[k] = v
		}
	}

	// Read template file
	templateContent, err := os.ReadFile(filepath.Join(c.config.TemplatePath, templateName))
	if err != nil {
		return fmt.Errorf("failed to read template file: %w", err)
	}

	// Substitute environment variables
	renderedConfig := substituteEnvVars(string(templateContent), data)

	// Properly encode cloud-init data in base64
	encodedConfig := base64Encode(renderedConfig)

	// Create secret
	var secretTemplate string
	if vmType == "control-plane" {
		secretTemplate = "control-plane-cloud-config-secret.yaml"
	} else {
		secretTemplate = "worker-node-cloud-config-secret.yaml"
	}

	// Set userdata in template data
	if vmType == "control-plane" {
		data["CONTROL_PLANE_USERDATA"] = encodedConfig
	} else {
		data["WORKER_USERDATA"] = encodedConfig
	}

	// Read the secret template file
	secretContent, err := os.ReadFile(filepath.Join(c.config.TemplatePath, secretTemplate))
	if err != nil {
		return fmt.Errorf("failed to read secret template file: %w", err)
	}

	// Substitute variables in the secret template
	renderedSecret := substituteEnvVars(string(secretContent), data)

	// Apply secret using kubectl
	return applyYAML(ctx, renderedSecret)
}

func (c *Client) createVM(ctx context.Context, namespace, vmName, vmType string) error {
	// Load VM template
	var templateName string
	if vmType == "control-plane" {
		templateName = "control-plane-template.yaml"
	} else {
		templateName = "worker-node-template.yaml"
	}

	// Create data map for template
	data := map[string]string{
		"CONTROL_PLANE_VM_NAME":  fmt.Sprintf("cks-control-plane-%s", namespace),
		"WORKER_VM_NAME":         fmt.Sprintf("cks-worker-node-%s", namespace),
		"SESSION_NAMESPACE":      namespace,
		"SESSION_ID":             strings.TrimPrefix(namespace, "user-session-"),
		"K8S_VERSION":            c.config.KubernetesVersion,
		"CPU_CORES":              c.config.VMCPUCores,
		"MEMORY":                 c.config.VMMemory,
		"STORAGE_SIZE":           c.config.VMStorageSize,
		"STORAGE_CLASS":          c.config.VMStorageClass,
		"IMAGE_URL":              c.config.VMImageURL,
		"POD_CIDR":               c.config.PodCIDR,
		"GOLDEN_IMAGE_NAME":      c.config.GoldenImageName,
		"GOLDEN_IMAGE_NAMESPACE": c.config.GoldenImageNamespace,
	}

	// Read the VM template file
	templateContent, err := os.ReadFile(filepath.Join(c.config.TemplatePath, templateName))
	if err != nil {
		return fmt.Errorf("failed to read VM template file: %w", err)
	}

	// Substitute variables in the VM template
	renderedVM := substituteEnvVars(string(templateContent), data)

	// Apply VM using kubectl
	return applyYAML(ctx, renderedVM)
}

// WaitForVMsReady waits for multiple VMs to be ready
func (c *Client) WaitForVMsReady(ctx context.Context, namespace string, vmNames ...string) error {
	for _, vmName := range vmNames {
		if err := c.WaitForVMReady(ctx, namespace, vmName); err != nil {
			return err
		}
	}
	return nil
}

func (c *Client) WaitForVMReady(ctx context.Context, namespace, vmName string) error {
	logrus.WithFields(logrus.Fields{
		"namespace": namespace,
		"vmName":    vmName,
	}).Info("Waiting for VM to become ready")

	startTime := time.Now()
	return wait.PollUntilContextCancel(ctx, 10*time.Second, true, func(context.Context) (bool, error) {
		// Check VM exists and get status
		vm, err := c.virtClient.VirtualMachine(namespace).Get(ctx, vmName, metav1.GetOptions{})
		if err != nil {
			if k8serrors.IsNotFound(err) {
				elapsed := time.Since(startTime)
				logrus.WithFields(logrus.Fields{
					"vmName":  vmName,
					"elapsed": elapsed,
				}).Debug("VM not found yet, continuing to wait...")
				return false, nil
			}
			// Log error but continue trying
			logrus.WithError(err).WithField("vmName", vmName).Warn("Error checking VM status, retrying...")
			return false, nil
		}

		// Log detailed VM status for debugging
		logrus.WithFields(logrus.Fields{
			"vmName":  vmName,
			"running": vm.Spec.Running,
			"created": vm.Status.Created,
			"ready":   vm.Status.Ready,
			"elapsed": time.Since(startTime),
		}).Debug("VM status check")

		// Check VMI status for more detailed information
		vmi, err := c.virtClient.VirtualMachineInstance(namespace).Get(ctx, vmName, metav1.GetOptions{})
		if err != nil {
			if k8serrors.IsNotFound(err) {
				logrus.WithField("vmName", vmName).Debug("VMI not found yet, VM not fully created")
				return false, nil
			}
			logrus.WithError(err).WithField("vmName", vmName).Warn("Error checking VMI status")
			return false, nil
		}

		// Log VMI phase for debugging
		logrus.WithFields(logrus.Fields{
			"vmName":  vmName,
			"phase":   vmi.Status.Phase,
			"elapsed": time.Since(startTime),
		}).Debug("VMI status check")

		// Check if VMI is in Running phase AND VM is marked as ready
		if vmi.Status.Phase == "Running" && vm.Status.Ready {
			elapsed := time.Since(startTime)
			logrus.WithFields(logrus.Fields{
				"vmName":  vmName,
				"elapsed": elapsed,
			}).Info("VM is ready and running")
			return true, nil
		}

		// Check if VMI is in Running phase for extended period (fallback)
		if vmi.Status.Phase == "Running" {
			if vmi.Status.PhaseTransitionTimestamps != nil {
				for _, transition := range vmi.Status.PhaseTransitionTimestamps {
					if transition.Phase == "Running" {
						runningDuration := time.Since(transition.PhaseTransitionTimestamp.Time)
						if runningDuration > 60*time.Second {
							logrus.WithFields(logrus.Fields{
								"vmName":     vmName,
								"runningFor": runningDuration,
							}).Info("VM has been running for 60+ seconds, considering it ready")
							return true, nil
						}
					}
				}
			}
		}

		// Check for failed states
		if vmi.Status.Phase == "Failed" {
			return false, fmt.Errorf("VM %s failed to start: phase is Failed", vmName)
		}

		// Continue waiting
		elapsed := time.Since(startTime)
		logrus.WithFields(logrus.Fields{
			"vmName":   vmName,
			"vmiPhase": vmi.Status.Phase,
			"vmReady":  vm.Status.Ready,
			"elapsed":  elapsed,
		}).Debug("VM not ready yet, continuing to wait...")
		return false, nil
	})
}

func (c *Client) VerifyKubeVirtAvailable(ctx context.Context) error {
	logrus.Info("Verifying KubeVirt availability")

	// Try to list VMs in the default namespace as a check
	_, err := c.virtClient.VirtualMachine("default").List(ctx, metav1.ListOptions{})
	if err != nil {
		logrus.WithError(err).Error("Failed to access KubeVirt API")
		return fmt.Errorf("failed to access KubeVirt API: %w", err)
	}

	logrus.Info("KubeVirt API is accessible")
	return nil
}

func (c *Client) getJoinCommand(ctx context.Context, namespace, controlPlaneName string) (string, error) {
	logrus.WithFields(logrus.Fields{
		"namespace":        namespace,
		"controlPlaneName": controlPlaneName,
	}).Info("Getting join command from control plane")

	// Adjust the VM name to match the actual name pattern
	actualVMName := fmt.Sprintf("cks-control-plane-%s", namespace)
	logrus.WithField("actualVMName", actualVMName).Info("Adjusted VM name for join command")

	// Wait for the VM to be fully ready with kubelet initialized
	time.Sleep(60 * time.Second)

	// Simple direct attempt without polling first
	logrus.Info("Attempting direct join command retrieval...")

	cmd := exec.Command(
		"virtctl", "ssh",
		fmt.Sprintf("vmi/%s", actualVMName),
		"-n", namespace,
		"-l", "suporte",
		"--local-ssh-opts", "-o StrictHostKeyChecking=no",
		"--command=cat /etc/kubeadm-join-command",
	)

	logrus.WithField("command", cmd.String()).Debug("Executing virtctl command")

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		logrus.WithError(err).WithField("stderr", stderr.String()).Error("Direct join command attempt failed")
		return "", fmt.Errorf("failed to execute join command: %v", err)
	}

	output := stdout.String()
	joinCommand := strings.TrimSpace(output)

	if joinCommand == "" {
		logrus.Error("Join command is empty")
		return "", fmt.Errorf("join command is empty")
	}

	logrus.WithField("joinCommand", joinCommand).Info("Successfully retrieved join command")
	return joinCommand, nil
}

// getVMIP gets the IP address of a VM
func (c *Client) getVMIP(ctx context.Context, namespace, vmName string) string {
	var ip string
	err := wait.PollImmediate(5*time.Second, 2*time.Minute, func() (bool, error) {
		// Get VM instance
		vmi, err := c.virtClient.VirtualMachineInstance(namespace).Get(ctx, vmName, metav1.GetOptions{})
		if err != nil {
			return false, nil // Keep trying
		}

		// Check if any interfaces exist
		if len(vmi.Status.Interfaces) == 0 {
			return false, nil
		}

		// Get IP from first interface
		ip = vmi.Status.Interfaces[0].IP
		if ip != "" {
			return true, nil
		}

		return false, nil
	})

	if err != nil {
		// Return placeholder if IP retrieval failed
		return "0.0.0.0"
	}

	return ip
}

// DeleteVMs deletes VMs and associated resources
func (c *Client) DeleteVMs(ctx context.Context, namespace string, vmNames ...string) error {
	for _, vmName := range vmNames {
		// Delete VM
		err := c.virtClient.VirtualMachine(namespace).Delete(ctx, vmName, metav1.DeleteOptions{})
		if err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("failed to delete VM %s: %v", vmName, err)
		}

		// Delete DataVolume
		dvName := fmt.Sprintf("%s-rootdisk", vmName)
		err = c.virtClient.CdiClient().CdiV1beta1().DataVolumes(namespace).Delete(ctx, dvName, metav1.DeleteOptions{})
		if err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("failed to delete DataVolume %s: %v", dvName, err)
		}

		// Delete cloud-init secret
		err = c.kubeClient.CoreV1().Secrets(namespace).Delete(ctx, vmName, metav1.DeleteOptions{})
		if err != nil && !errors.IsNotFound(err) {
			return fmt.Errorf("failed to delete Secret %s: %v", vmName, err)
		}
	}

	return nil
}

func (c *Client) ExecuteCommandInVM(ctx context.Context, namespace, vmName, command string) (string, error) {
	logrus.WithFields(logrus.Fields{
		"vmName":    vmName,
		"namespace": namespace,
		"command":   command,
	}).Debug("Executing command in VM using virtctl SSH")

	// Adjust the VM name to match the actual name pattern
	actualVMName := vmName
	if strings.HasPrefix(vmName, "cks-") && strings.Contains(vmName, namespace) {
		// VM name already includes the namespace pattern
		actualVMName = vmName
	} else if strings.HasPrefix(vmName, "cks-") {
		// Need to append namespace pattern
		actualVMName = fmt.Sprintf("%s-%s", vmName, namespace)
	}

	logrus.WithField("actualVMName", actualVMName).Debug("Adjusted VM name for command execution")

	// Create the virtctl ssh command with proper arguments
	args := []string{
		"ssh",
		fmt.Sprintf("vmi/%s", vmName),
		"-n", namespace,
		"-l", "suporte",
		"--local-ssh-opts", "-o StrictHostKeyChecking=no",
		"--command=" + command,
	}

	logrus.WithField("virtctlArgs", args).Debug("Virtctl command arguments")

	cmd := exec.CommandContext(ctx, "virtctl", args...)

	// Create buffers for stdout and stderr
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Execute the command
	if err := cmd.Run(); err != nil {
		// Read error output
		logrus.WithError(err).WithFields(logrus.Fields{
			"stderr": stderr.String(),
			"stdout": stdout.String(),
		}).Debug("Command execution failed")
		return "", fmt.Errorf("command execution failed: %w, output: %s", err, stderr.String())
	}

	logrus.WithFields(logrus.Fields{
		"stdout": stdout.String(),
		"vmName": actualVMName,
	}).Debug("Command executed successfully")

	return stdout.String(), nil
}

// substituteEnvVars replaces ${VAR} with the value of the environment variable VAR
func substituteEnvVars(input string, vars map[string]string) string {
	result := input

	// Regular expression to find ${VAR} patterns
	re := regexp.MustCompile(`\${([A-Za-z0-9_]+)}`)

	// Replace all occurrences
	result = re.ReplaceAllStringFunc(result, func(match string) string {
		// Extract variable name without ${ and }
		varName := match[2 : len(match)-1]

		// Look up the value in vars map first, then in environment
		if value, ok := vars[varName]; ok {
			return value
		}

		// If not in vars map, try environment
		if value, ok := os.LookupEnv(varName); ok {
			return value
		}

		// If not found, return the original ${VAR}
		return match
	})

	return result
}

// loadTemplates loads all template files from a directory
func loadTemplates(templatePath string) (map[string]*template.Template, error) {
	templates := make(map[string]*template.Template)

	// Template files to load
	templateFiles := []string{
		"control-plane-cloud-config.yaml",
		"worker-node-cloud-config.yaml",
		"control-plane-cloud-config-secret.yaml",
		"worker-node-cloud-config-secret.yaml",
		"control-plane-template.yaml",
		"worker-node-template.yaml",
	}

	for _, fileName := range templateFiles {
		filePath := filepath.Join(templatePath, fileName)

		// Read template file
		tmplContent, err := os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("failed to read template file %s: %v", filePath, err)
		}

		// Parse template
		tmpl, err := template.New(fileName).Parse(string(tmplContent))
		if err != nil {
			return nil, fmt.Errorf("failed to parse template %s: %v", fileName, err)
		}

		templates[fileName] = tmpl
	}

	return templates, nil
}

// base64Encode encodes a string to base64
func base64Encode(input string) string {
	return base64.StdEncoding.EncodeToString([]byte(input))
}

// applyYAML applies YAML to the cluster
func applyYAML(ctx context.Context, yaml string) error {
	// Create a kubectl apply command with stdin for the YAML content
	cmd := exec.CommandContext(ctx, "kubectl", "apply", "-f", "-")

	// Create a pipe to write the YAML to stdin
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdin pipe: %w", err)
	}

	// Create a buffer for the stderr output
	var stderr strings.Builder
	cmd.Stderr = &stderr

	// Start the command
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start kubectl apply: %w", err)
	}

	// Write the YAML to stdin
	io.WriteString(stdin, yaml)
	stdin.Close()

	// Wait for the command to complete
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("kubectl apply failed: %w, stderr: %s", err, stderr.String())
	}

	return nil
}

// GetVMStatus gets the status of a VM
func (c *Client) GetVMStatus(ctx context.Context, namespace, vmName string) (string, error) {
	vm, err := c.virtClient.VirtualMachine(namespace).Get(ctx, vmName, metav1.GetOptions{})
	if err != nil {
		return "", err
	}

	if vm.Status.Ready {
		return "Running", nil
	}

	if vm.Status.Created {
		return "Starting", nil
	}

	return "Pending", nil
}

// CreateVMSnapshot creates a snapshot of a virtual machine
func (c *Client) CreateVMSnapshot(ctx context.Context, namespace, vmName, snapshotName string) error {
	logrus.WithFields(logrus.Fields{
		"namespace":    namespace,
		"vmName":       vmName,
		"snapshotName": snapshotName,
	}).Info("Creating VM snapshot")

	snapshot := &snapshotv1beta1.VirtualMachineSnapshot{
		ObjectMeta: metav1.ObjectMeta{
			Name:      snapshotName,
			Namespace: namespace,
			Labels: map[string]string{
				"cks.io/snapshot": "base-cluster",
				"cks.io/vm-role": func() string {
					if strings.Contains(vmName, "control-plane") {
						return "control-plane"
					}
					return "worker"
				}(),
			},
		},
		Spec: snapshotv1beta1.VirtualMachineSnapshotSpec{
			Source: corev1.TypedLocalObjectReference{
				APIGroup: &[]string{"kubevirt.io"}[0], // Add the API group
				Kind:     "VirtualMachine",
				Name:     vmName,
			},
		},
	}

	_, err := c.virtClient.VirtualMachineSnapshot(namespace).Create(ctx, snapshot, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("failed to create snapshot %s: %w", snapshotName, err)
	}

	logrus.WithField("snapshotName", snapshotName).Info("VM snapshot creation initiated")
	return nil
}

// WaitForSnapshotReady waits for a snapshot to be ready to use
func (c *Client) WaitForSnapshotReady(ctx context.Context, namespace, snapshotName string) error {
	logrus.WithFields(logrus.Fields{
		"namespace":    namespace,
		"snapshotName": snapshotName,
	}).Info("Waiting for snapshot to be ready")

	startTime := time.Now()
	return wait.PollUntilContextCancel(ctx, 10*time.Second, true, func(context.Context) (bool, error) {
		snapshot, err := c.virtClient.VirtualMachineSnapshot(namespace).Get(ctx, snapshotName, metav1.GetOptions{})
		if err != nil {
			if k8serrors.IsNotFound(err) {
				logrus.WithField("snapshotName", snapshotName).Debug("Snapshot not found yet")
				return false, nil
			}
			logrus.WithError(err).WithField("snapshotName", snapshotName).Warn("Error checking snapshot status")
			return false, nil
		}

		elapsed := time.Since(startTime)
		logrus.WithFields(logrus.Fields{
			"snapshotName": snapshotName,
			"elapsed":      elapsed,
			"phase": func() string {
				if snapshot.Status != nil {
					return string(snapshot.Status.Phase)
				}
				return "Unknown"
			}(),
			"readyToUse": func() bool {
				if snapshot.Status != nil && snapshot.Status.ReadyToUse != nil {
					return *snapshot.Status.ReadyToUse
				}
				return false
			}(),
		}).Debug("Snapshot status check")

		if snapshot.Status != nil && snapshot.Status.ReadyToUse != nil && *snapshot.Status.ReadyToUse {
			logrus.WithFields(logrus.Fields{
				"snapshotName": snapshotName,
				"elapsed":      elapsed,
			}).Info("Snapshot is ready")
			return true, nil
		}

		// Check for failed state
		if snapshot.Status != nil && snapshot.Status.Phase == snapshotv1beta1.Failed {
			return false, fmt.Errorf("snapshot %s failed to create", snapshotName)
		}

		return false, nil
	})
}

// CheckSnapshotExists checks if a snapshot exists and is ready
func (c *Client) CheckSnapshotExists(ctx context.Context, namespace, snapshotName string) bool {
	snapshot, err := c.virtClient.VirtualMachineSnapshot(namespace).Get(ctx, snapshotName, metav1.GetOptions{})
	if err != nil {
		return false
	}

	return snapshot.Status != nil && snapshot.Status.ReadyToUse != nil && *snapshot.Status.ReadyToUse
}

// DeleteVMSnapshot deletes a VM snapshot
func (c *Client) DeleteVMSnapshot(ctx context.Context, namespace, snapshotName string) error {
	logrus.WithFields(logrus.Fields{
		"namespace":    namespace,
		"snapshotName": snapshotName,
	}).Info("Deleting VM snapshot")

	err := c.virtClient.VirtualMachineSnapshot(namespace).Delete(ctx, snapshotName, metav1.DeleteOptions{})
	if err != nil && !k8serrors.IsNotFound(err) {
		return fmt.Errorf("failed to delete snapshot %s: %w", snapshotName, err)
	}

	logrus.WithField("snapshotName", snapshotName).Info("VM snapshot deleted")
	return nil
}

// StartVM starts a virtual machine
func (c *Client) StartVM(ctx context.Context, namespace, vmName string) error {
	logrus.WithFields(logrus.Fields{
		"namespace": namespace,
		"vmName":    vmName,
	}).Info("Starting VM")

	vm, err := c.virtClient.VirtualMachine(namespace).Get(ctx, vmName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get VM %s: %w", vmName, err)
	}

	// Set running to true
	vm.Spec.Running = &[]bool{true}[0]
	_, err = c.virtClient.VirtualMachine(namespace).Update(ctx, vm, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to start VM %s: %w", vmName, err)
	}

	logrus.WithField("vmName", vmName).Info("VM start initiated")
	return nil
}

// VirtClient returns the KubeVirt client for direct API access
func (c *Client) VirtClient() kubecli.KubevirtClient {
	return c.virtClient
}

// StopVMs stops multiple VMs for consistent snapshot creation
func (c *Client) StopVMs(ctx context.Context, namespace string, vmNames ...string) error {
	logrus.WithFields(logrus.Fields{
		"namespace": namespace,
		"vmNames":   vmNames,
	}).Info("Freezing VMs for snapshot")

	errChan := make(chan error, len(vmNames))

	// Stop all VMs in parallel
	for _, vmName := range vmNames {
		go func(name string) {
			vm, err := c.virtClient.VirtualMachine(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				errChan <- fmt.Errorf("failed to get VM %s: %w", name, err)
				return
			}

			// Set running to false
			vm.Spec.Running = &[]bool{false}[0]
			_, err = c.virtClient.VirtualMachine(namespace).Update(ctx, vm, metav1.UpdateOptions{})
			if err != nil {
				errChan <- fmt.Errorf("failed to stop VM %s: %w", name, err)
				return
			}

			// Wait for VM to stop
			err = c.waitForVMStopped(ctx, namespace, name)
			errChan <- err
		}(vmName)
	}

	// Wait for all VMs to stop
	for range vmNames {
		if err := <-errChan; err != nil {
			return err
		}
	}

	logrus.WithField("vmNames", vmNames).Info("All VMs stopped successfully")
	return nil
}

// waitForVMStopped waits for a VM to be completely stopped
func (c *Client) waitForVMStopped(ctx context.Context, namespace, vmName string) error {
	return wait.PollUntilContextCancel(ctx, 5*time.Second, true, func(context.Context) (bool, error) {
		// Check if VMI still exists
		_, err := c.virtClient.VirtualMachineInstance(namespace).Get(ctx, vmName, metav1.GetOptions{})
		if err != nil {
			if k8serrors.IsNotFound(err) {
				// VMI doesn't exist anymore, VM is stopped
				return true, nil
			}
			return false, nil
		}
		// VMI still exists, VM is not fully stopped
		return false, nil
	})
}
