// Updated client.go implementation to fix build errors

package kubevirt

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
	"kubevirt.io/client-go/kubecli"

	"github.com/fullstack-pw/cks/backend/internal/config"
	"github.com/sirupsen/logrus"
)

// Client represents a KubeVirt client for managing VMs
type Client struct {
	kubeClient    kubernetes.Interface
	virtClient    kubecli.KubevirtClient
	config        *config.Config
	restConfig    *rest.Config // Store the REST config
	templateCache map[string]*template.Template
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

func (c *Client) CreateCluster(ctx context.Context, namespace, controlPlaneName, workerNodeName string) error {
	// Add log for tracking
	logrus.WithFields(logrus.Fields{
		"namespace":    namespace,
		"controlPlane": controlPlaneName,
		"workerNode":   workerNodeName,
	}).Info("Starting VM cluster creation")

	// Create secret with cloud-init data for control plane
	err := c.createCloudInitSecret(ctx, namespace, controlPlaneName, "control-plane")
	if err != nil {
		return fmt.Errorf("failed to create control plane cloud-init secret: %v", err)
	}
	logrus.Info("Created control plane cloud-init secret")

	// Create control plane VM
	err = c.createVM(ctx, namespace, controlPlaneName, "control-plane")
	if err != nil {
		return fmt.Errorf("failed to create control plane VM: %v", err)
	}
	logrus.Info("Created control plane VM")

	// Wait for control plane to be ready before creating worker
	err = c.WaitForVMReady(ctx, namespace, controlPlaneName)
	if err != nil {
		return fmt.Errorf("control plane VM failed to become ready: %v", err)
	}
	logrus.Info("Control plane VM is ready")

	// Get join command from control plane
	joinCommand, err := c.getJoinCommand(ctx, namespace, controlPlaneName)
	if err != nil {
		return fmt.Errorf("failed to get join command: %v", err)
	}

	// Create secret with cloud-init data for worker node
	err = c.createCloudInitSecret(ctx, namespace, workerNodeName, "worker", map[string]string{
		"JOIN_COMMAND":           joinCommand,
		"JOIN":                   joinCommand,
		"CONTROL_PLANE_ENDPOINT": fmt.Sprintf("%s.%s.pod.cluster.local", strings.ReplaceAll(c.getVMIP(ctx, namespace, controlPlaneName), ".", "-"), namespace),
		"CONTROL_PLANE_IP":       c.getVMIP(ctx, namespace, controlPlaneName),
		"CONTROL_PLANE_VM_NAME":  controlPlaneName,
	})
	if err != nil {
		return fmt.Errorf("failed to create worker node cloud-init secret: %v", err)
	}

	// Create worker node VM
	return c.createVM(ctx, namespace, workerNodeName, "worker")
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
		"CONTROL_PLANE_VM_NAME": fmt.Sprintf("cks-control-plane-%s", namespace),
		"WORKER_VM_NAME":        fmt.Sprintf("cks-worker-node-%s", namespace),
		"SESSION_NAMESPACE":     namespace,
		"SESSION_ID":            strings.TrimPrefix(namespace, "user-session-"),
		"K8S_VERSION":           c.config.KubernetesVersion,
		"CPU_CORES":             c.config.VMCPUCores,
		"MEMORY":                c.config.VMMemory,
		"STORAGE_SIZE":          c.config.VMStorageSize,
		"STORAGE_CLASS":         c.config.VMStorageClass,
		"IMAGE_URL":             c.config.VMImageURL,
		"POD_CIDR":              c.config.PodCIDR,
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

	return wait.PollUntilContextCancel(ctx, 10*time.Second, true, func(context.Context) (bool, error) {
		// Check VM exists and is running
		vm, err := c.virtClient.VirtualMachine(namespace).Get(ctx, vmName, metav1.GetOptions{})
		if err != nil {
			if errors.IsNotFound(err) {
				logrus.WithField("vmName", vmName).Debug("VM not found yet, retrying...")
				return false, nil
			}
			logrus.WithError(err).WithField("vmName", vmName).Warn("Error checking VM status")
			return false, nil // Keep trying despite errors
		}

		// Log detailed VM status for debugging
		logrus.WithFields(logrus.Fields{
			"vmName":    vmName,
			"running":   vm.Spec.Running,
			"created":   vm.Status.Created,
			"ready":     vm.Status.Ready,
			"condition": vm.Status.Conditions,
		}).Debug("VM status check")

		// Also check VMI status which might have more information
		vmi, err := c.virtClient.VirtualMachineInstance(namespace).Get(ctx, vmName, metav1.GetOptions{})
		if err != nil {
			if errors.IsNotFound(err) {
				logrus.WithField("vmName", vmName).Debug("VMI not found yet, VM not fully created, retrying...")
				return false, nil
			}
			logrus.WithError(err).WithField("vmName", vmName).Warn("Error checking VMI status")
			return false, nil
		}

		// Log VMI phase for debugging
		logrus.WithFields(logrus.Fields{
			"vmName": vmName,
			"phase":  vmi.Status.Phase,
			"reason": vmi.Status.Phase,
		}).Debug("VMI status check")

		// Check if VMI is in Running phase AND VM is marked as ready
		if vmi.Status.Phase == "Running" && vm.Status.Ready {
			logrus.WithField("vmName", vmName).Info("VM is ready and running")
			return true, nil
		}

		// Check if VMI is in Running phase even if VM.Ready isn't true yet
		// This might indicate the VM is actually ready but the status hasn't updated
		if vmi.Status.Phase == "Running" {
			// If VMI has been running for a while, consider the VM ready despite VM.Ready flag
			if vmi.Status.PhaseTransitionTimestamps != nil && len(vmi.Status.PhaseTransitionTimestamps) > 0 {
				for _, transition := range vmi.Status.PhaseTransitionTimestamps {
					if transition.Phase == "Running" {
						runningDuration := time.Since(transition.PhaseTransitionTimestamp.Time)
						// If VMI has been in Running phase for over 60 seconds, consider it ready
						if runningDuration > 60*time.Second {
							logrus.WithField("vmName", vmName).Info("VM has been running for 60+ seconds, considering it ready")
							return true, nil
						}
						logrus.WithFields(logrus.Fields{
							"vmName":     vmName,
							"runningFor": runningDuration.Seconds(),
						}).Debug("VM is running but not yet considered ready")
						break
					}
				}
			}
		}

		logrus.WithFields(logrus.Fields{
			"vmName":   vmName,
			"vmiPhase": vmi.Status.Phase,
			"vmReady":  vm.Status.Ready,
		}).Debug("VM not ready yet, retrying...")
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
	// This might take longer than just the VM being "ready"
	time.Sleep(30 * time.Second)

	// Wait for kubeadm init to complete and join command to be available
	var joinCommand string
	err := wait.PollImmediate(15*time.Second, 15*time.Minute, func() (bool, error) {
		// Execute command using virtctl
		cmd := exec.Command(
			"virtctl", "ssh",
			fmt.Sprintf("vmi/%s", actualVMName),
			"-n", namespace,
			"-l", "suporte",
			"--local-ssh-opts=-o StrictHostKeyChecking=no",
			"--command=cat /etc/kubeadm-join-command",
		)

		logrus.WithField("command", cmd.String()).Debug("Executing virtctl command")

		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr

		err := cmd.Run()
		if err != nil {
			logrus.WithError(err).WithField("stderr", stderr.String()).Debug("Failed to execute virtctl, retrying...")
			return false, nil // Keep trying
		}

		if stderr.Len() > 0 {
			logrus.WithField("stderr", stderr.String()).Debug("Command returned error, retrying...")
			return false, nil
		}

		// Got join command
		output := stdout.String()
		joinCommand = strings.TrimSpace(output)
		if joinCommand != "" {
			// Replace IP addresses with hostname
			re := regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`)
			joinCommand = re.ReplaceAllString(joinCommand, actualVMName)

			logrus.WithField("joinCommand", joinCommand).Info("Successfully retrieved join command")
			return true, nil
		}

		logrus.Debug("Join command not available yet, retrying...")
		return false, nil
	})

	if err != nil {
		return "", fmt.Errorf("failed to get join command: %v", err)
	}

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

func (c *Client) GetVMPodName(ctx context.Context, namespace, vmName string) (string, error) {
	logrus.WithFields(logrus.Fields{
		"namespace": namespace,
		"vmName":    vmName,
	}).Debug("Getting pod name for VM")

	vmi, err := c.virtClient.VirtualMachineInstance(namespace).Get(ctx, vmName, metav1.GetOptions{})
	if err != nil {
		return "", err
	}

	// The pod name is typically stored in the status
	if vmi.Status.NodeName != "" {
		// List pods in the namespace
		logrus.WithField("labelSelector", fmt.Sprintf("kubevirt.io/domain=%s", vmName)).Debug("Listing pods with label selector")

		pods, err := c.kubeClient.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
			LabelSelector: fmt.Sprintf("kubevirt.io/domain=%s", vmName),
		})
		if err != nil {
			return "", err
		}

		if len(pods.Items) > 0 {
			logrus.WithField("podName", pods.Items[0].Name).Debug("Found pod for VM")
			return pods.Items[0].Name, nil
		}
	}

	// If not found with the exact name, try listing all pods
	logrus.Debug("Pod not found with direct label, listing all pods in namespace")
	allPods, err := c.kubeClient.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return "", err
	}

	// Look for a pod that might be related to our VM
	for _, pod := range allPods.Items {
		if strings.Contains(pod.Name, "virt-launcher") && strings.Contains(pod.Name, strings.Replace(vmName, "cks-", "", 1)) {
			logrus.WithField("podName", pod.Name).Info("Found pod with partial match for VM")
			return pod.Name, nil
		}
	}

	return "", fmt.Errorf("no pod found for VM %s", vmName)
}

// executeCommand executes a command in a pod
func (c *Client) executeCommand(ctx context.Context, namespace, pod, container string, command []string) (string, string, error) {
	// Create command execution request
	req := c.kubeClient.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(pod).
		Namespace(namespace).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: container,
			Command:   command,
			Stdin:     false,
			Stdout:    true,
			Stderr:    true,
			TTY:       false,
		}, scheme.ParameterCodec)

	// Execute command - Use the stored restConfig
	executor, err := remotecommand.NewSPDYExecutor(c.restConfig, "POST", req.URL())
	if err != nil {
		return "", "", err
	}

	var stdout, stderr strings.Builder
	err = executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdout: &stdout,
		Stderr: &stderr,
	})

	return stdout.String(), stderr.String(), err
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

// ExecuteCommandInVM executes a command in a VM
func (c *Client) ExecuteCommandInVM(ctx context.Context, namespace, vmName, command string) (string, error) {
	pod, err := c.GetVMPodName(ctx, namespace, vmName)
	if err != nil {
		return "", err
	}

	// Split command into args
	cmdArgs := strings.Split(command, " ")

	stdout, stderr, err := c.executeCommand(ctx, namespace, pod, "compute", cmdArgs)
	if err != nil {
		return "", fmt.Errorf("command execution failed: %v, stderr: %s", err, stderr)
	}

	if stderr != "" {
		return stdout, fmt.Errorf("command returned error: %s", stderr)
	}

	return stdout, nil
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
