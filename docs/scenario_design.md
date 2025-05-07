# docs/scenario-design.md - Design document for the scenario definition system

# cks-Local Scenario Definition System

## Overview

The scenario definition system provides a structured format for creating, managing, and validating CKS practice scenarios. It uses a combination of YAML for metadata and configuration, and Markdown for content, making it easy to create and maintain scenarios.

## Design Goals

1. **Simplicity**: Easy for scenario authors to create and modify without deep technical knowledge
2. **Flexibility**: Support for various types of scenarios and validation methods
3. **Portability**: Scenarios should be easily shareable and version-controlled
4. **Extensibility**: System should be extendable for future scenario types and features
5. **Automation**: Support for automated validation of scenario tasks
6. **Reusability**: Common components and patterns should be reusable across scenarios

## Scenario Structure

Each scenario is defined as a directory with the following structure:

```
scenarios/
└── scenario-id/
    ├── metadata.yaml     # Scenario metadata
    ├── setup.yaml        # Setup configuration
    ├── tasks/
    │   ├── 01-task.md    # Task markdown files
    │   ├── 02-task.md
    │   └── ...
    ├── validation/
    │   ├── 01-validation.yaml
    │   ├── 02-validation.yaml
    │   └── ...
    └── cleanup.yaml      # Cleanup configuration (optional)
```

## Metadata Definition

The `metadata.yaml` file contains the basic information about the scenario:

```yaml
id: advanced-pod-security
title: "Advanced Pod Security Configuration"
description: |
  Learn how to configure and enforce Pod Security Standards in a Kubernetes cluster.
  This scenario covers security contexts, Pod Security Admission, and security best practices.
version: "1.0.0"
difficulty: intermediate
time_estimate: "45m"
topics:
  - pod-security
  - security-context
  - pss
  - rbac
author: "Jane Doe"
requirements:
  k8s_version: "1.33.0"
  resources:
    cpu: 2
    memory: 2Gi
```

## Setup Configuration

The `setup.yaml` file defines how the environment should be set up before the user starts the scenario:

```yaml
# Setup script for the scenario
resources:
  # Resources to create
  - kind: ConfigMap
    apiVersion: v1
    metadata:
      name: scenario-config
      namespace: default
    data:
      config.json: |
        {
          "key": "value"
        }

  - kind: Namespace
    apiVersion: v1
    metadata:
      name: secure-apps
      labels:
        pod-security.kubernetes.io/enforce: baseline

commands:
  # Commands to run on the control plane during setup
  control_plane:
    - command: "kubectl create ns vulnerable-apps"
    - command: "kubectl label ns vulnerable-apps pod-security.kubernetes.io/enforce=privileged"
    - command: |
        cat <<EOF | kubectl apply -f -
        apiVersion: v1
        kind: Secret
        metadata:
          name: scenario-secret
          namespace: default
        type: Opaque
        data:
          token: YWJjMTIzCg==
        EOF

  # Commands to run on worker nodes during setup
  worker_nodes:
    - command: "mkdir -p /tmp/scenario-data"
    - command: "echo 'test-data' > /tmp/scenario-data/file.txt"

files:
  # Files to create or modify
  - path: /root/scenario-files/example-pod.yaml
    content: |
      apiVersion: v1
      kind: Pod
      metadata:
        name: example-pod
        namespace: default
      spec:
        containers:
        - name: nginx
          image: nginx:1.14.2
          ports:
          - containerPort: 80

wait:
  # Wait conditions before considering setup complete
  - type: resource
    kind: Pod
    name: example-pod
    namespace: default
    condition: Ready
    timeout: 60s

  - type: command
    command: "kubectl get nodes | grep Ready | wc -l"
    expect: "2"
    timeout: 120s
```

## Task Definition

Tasks are defined as Markdown files in the `tasks` directory. Each file follows a structured format:

```markdown
# Task 1: Configure Pod Security Standards

## Description

In this task, you will configure Pod Security Standards for different namespaces based on security requirements.

## Background

Pod Security Standards define different levels of security restrictions:
- **Privileged**: Unrestricted policy, equivalent to no policy
- **Baseline**: Minimally restrictive policy that prevents known privilege escalations
- **Restricted**: Heavily restricted policy following security best practices

## Objectives

1. Create a new namespace called `restricted-ns`
2. Configure the namespace to enforce the "restricted" Pod Security Standard
3. Create a compliant Pod in the restricted namespace
4. Attempt to create a privileged Pod to verify the enforcement

## Step-by-Step Guide

1. First, create the new namespace:
   ```bash
   kubectl create ns restricted-ns
   ```

2. Apply the "restricted" Pod Security Standard using labels:
   ```bash
   kubectl label ns restricted-ns pod-security.kubernetes.io/enforce=restricted
   ```

3. Create a compliant Pod in the restricted namespace by saving the following YAML to `compliant-pod.yaml`:
   ```yaml
   apiVersion: v1
   kind: Pod
   metadata:
     name: compliant-pod
     namespace: restricted-ns
   spec:
     securityContext:
       runAsNonRoot: true
       seccompProfile:
         type: RuntimeDefault
     containers:
     - name: nginx
       image: nginx:1.14.2
       securityContext:
         allowPrivilegeEscalation: false
         capabilities:
           drop:
           - ALL
       ports:
       - containerPort: 80
   ```

   Apply the compliant Pod:
   ```bash
   kubectl apply -f compliant-pod.yaml
   ```

4. Try to create a non-compliant Pod to verify enforcement by saving the following YAML to `privileged-pod.yaml`:
   ```yaml
   apiVersion: v1
   kind: Pod
   metadata:
     name: privileged-pod
     namespace: restricted-ns
   spec:
     containers:
     - name: nginx
       image: nginx:1.14.2
       securityContext:
         privileged: true
       ports:
       - containerPort: 80
   ```

   Apply the non-compliant Pod (this should be rejected):
   ```bash
   kubectl apply -f privileged-pod.yaml
   ```

## Hints

<details>
<summary>Hint 1: Pod Security admission labels</summary>
Pod Security admission uses labels to enforce standards. The main label format is `pod-security.kubernetes.io/enforce`.
</details>

<details>
<summary>Hint 2: Checking Pod Security Standards</summary>
You can check the Pod Security Standards on a namespace using:
```bash
kubectl get ns restricted-ns --show-labels
```
</details>

## Validation Criteria

- Namespace `restricted-ns` exists
- Namespace has the correct Pod Security Standard label
- A compliant Pod is running in the namespace
- Attempting to create a privileged Pod in the namespace is rejected
```

## Validation Definition

Each task has a corresponding validation YAML file that defines how to validate the task:

```yaml
# Validation for Task 1: Configure Pod Security Standards
id: task-1-validation
description: "Validates Pod Security Standards configuration"
criteria:
  # Check resources
  - type: resource_exists
    resource:
      kind: Namespace
      name: restricted-ns
    error_message: "Namespace 'restricted-ns' does not exist"

  # Check labels
  - type: resource_property
    resource:
      kind: Namespace
      name: restricted-ns
    property: metadata.labels
    condition: contains
    value:
      pod-security.kubernetes.io/enforce: restricted
    error_message: "Namespace 'restricted-ns' does not have the required Pod Security Standard label"

  # Check running pod
  - type: resource_exists
    resource:
      kind: Pod
      name: compliant-pod
      namespace: restricted-ns
    condition: running
    error_message: "Compliant Pod is not running in the restricted namespace"

  # Custom command validation
  - type: command
    command: |
      kubectl auth can-i create pods --as=system:serviceaccount:restricted-ns:default -n restricted-ns
    output_match: yes
    error_message: "Default service account in restricted-ns cannot create pods"

  # Check if privileged containers are blocked
  - type: command
    command: |
      cat <<EOF | kubectl apply -f - 2>&1 | grep -i 'forbidden'
      apiVersion: v1
      kind: Pod
      metadata:
        name: test-privileged-pod
        namespace: restricted-ns
      spec:
        containers:
        - name: nginx
          image: nginx:1.14.2
          securityContext:
            privileged: true
      EOF
    output_contains: "forbidden"
    error_message: "Privileged pods are not being rejected in the restricted namespace"
```

## Cleanup Configuration

The `cleanup.yaml` file defines cleanup actions to be performed after the scenario is completed:

```yaml
# Cleanup configuration
resources:
  # Resources to delete
  - kind: Namespace
    name: restricted-ns
    wait: true
    
  - kind: ConfigMap
    name: scenario-config
    namespace: default
    
  - kind: Secret
    name: scenario-secret
    namespace: default

commands:
  # Commands to run on control plane during cleanup
  control_plane:
    - command: "kubectl delete ns vulnerable-apps"
    - command: "rm -f /root/scenario-files/example-pod.yaml"
    
  # Commands to run on worker nodes during cleanup
  worker_nodes:
    - command: "rm -rf /tmp/scenario-data"
```

## Scenario Categories and Progression

Scenarios are organized into categories and progressions to provide a structured learning path:

```yaml
# categories.yaml
categories:
  pod-security:
    name: "Pod Security"
    description: "Scenarios focusing on securing pods and containers"
    
  network-security:
    name: "Network Security"
    description: "Scenarios focusing on secure networking and policies"
    
  rbac:
    name: "RBAC and Authentication"
    description: "Scenarios focusing on access control and authentication"
    
  secrets-management:
    name: "Secrets Management"
    description: "Scenarios focusing on secure secrets handling"
    
  etcd-security:
    name: "ETCD Security"
    description: "Scenarios focusing on securing the Kubernetes data store"
    
  runtime-security:
    name: "Runtime Security"
    description: "Scenarios focusing on container runtime security"

progressions:
  cks-preparation:
    name: "CKS Certification Preparation"
    description: "A structured path to prepare for the CKS certification exam"
    scenarios:
      - id: basic-pod-security
        order: 1
      - id: advanced-pod-security
        order: 2
      - id: network-policies
        order: 3
      # ... more scenarios
```

## Example Scenarios

Here are some example scenario ideas for the CKS exam preparation:

1. **Basic Pod Security**
   - SecurityContext configuration
   - Running containers as non-root
   - Dropping capabilities
   
2. **Network Policy Implementation**
   - Creating default deny policies
   - Allowing specific traffic
   - Implementing namespace isolation
   
3. **RBAC Configuration**
   - Creating service accounts
   - Assigning roles and role bindings
   - Implementing least privilege
   
4. **Secrets Management**
   - Creating and using Kubernetes secrets
   - Encrypting secrets at rest
   - Mounting secrets in pods
   
5. **CIS Benchmarking**
   - Running kube-bench
   - Fixing common security issues
   - Implementing best practices
   
6. **Image Security**
   - Implementing ImagePolicyWebhook
   - Scanning images for vulnerabilities
   - Creating secure image pull policies
   
7. **Secure Cluster Setup**
   - Configuring TLS
   - Setting up secure kubelet configuration
   - Implementing audit logging
   
8. **Runtime Security with Falco**
   - Installing and configuring Falco
   - Creating custom rules
   - Responding to security events
   
9. **Supply Chain Security**
   - Implementing Software Bill of Materials (SBOM)
   - Verifying image signatures
   - Using admission controllers for supply chain security
   
10. **Cluster Hardening**
    - Restricting API access
    - Removing unnecessary components
    - Implementing network segmentation

## Implementation Considerations

### Storage and Versioning

Scenarios should be stored in a Git repository for version control and easy distribution. The repository structure should match the scenario structure described above.

### Scenario Loading

The backend service should load scenarios from a mounted volume or ConfigMap containing the scenario files. Scenarios can be loaded on startup or dynamically when requested.

### Validation Engine

The validation engine should be flexible enough to handle different types of validation:

1. **Resource validation**: Check if resources exist and have required properties
2. **Command validation**: Run commands and validate output
3. **State validation**: Check system state (files, processes, etc.)
4. **Custom validation**: Run custom scripts for complex validation

### Scenario Updates

Scenarios should be updatable without requiring a rebuild of the platform. A mechanism for hot-reloading scenarios should be implemented.

### Internationalization

The scenario definition system should support multiple languages through translation files associated with each scenario.

## Development Workflow

### Creating a New Scenario

1. Create a new directory for the scenario with a unique ID
2. Create the metadata.yaml file with basic information
3. Define the setup.yaml file for environment setup
4. Create task files in the tasks directory
5. Define validation rules in the validation directory
6. Test the scenario locally
7. Commit to the scenario repository

### Testing Scenarios

A testing framework should be created to validate scenarios:

1. Automatic validation of YAML syntax
2. Test scenario setup and cleanup
3. Verify task validation rules
4. Test end-to-end workflow

## Future Enhancements

### Scenario Templates

Create templates for common scenario types to make it easier to create new scenarios.

### Scenario Import/Export

Allow importing and exporting scenarios in a compressed format for sharing.

### Scenario Versioning

Implement semantic versioning for scenarios to track changes and compatibility.

### Interactive Tutorials

Add support for guided tutorials with interactive elements and automatic progression.

### Submission Pipeline

Create a submission pipeline for community-contributed scenarios with review and approval processes.

### Scoring System

Implement a scoring system for scenarios based on completion time, hints used, and task success.

### Difficulty Progression

Create adaptive difficulty progression based on user performance in previous scenarios.