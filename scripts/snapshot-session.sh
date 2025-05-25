#!/bin/bash
# snapshot-session.sh - Create snapshots from a running CKS session

set -euo pipefail

# Configuration
SCRIPT_NAME=$(basename "$0")
LOG_PREFIX="[SNAPSHOT]"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}${LOG_PREFIX} INFO:${NC} $1"
}

log_success() {
    echo -e "${GREEN}${LOG_PREFIX} SUCCESS:${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}${LOG_PREFIX} WARN:${NC} $1"
}

log_error() {
    echo -e "${RED}${LOG_PREFIX} ERROR:${NC} $1"
}

# Usage function
usage() {
    cat << EOF
Usage: $SCRIPT_NAME <session-id>

Create VirtualMachine snapshots from a running CKS session.

Arguments:
    session-id    The session ID (e.g., 76c3ac1b)

Examples:
    $SCRIPT_NAME 76c3ac1b
    
This will create snapshots named:
    - cks-control-plane-base-snapshot
    - cks-worker-base-snapshot
    
In the vm-templates namespace for future fast provisioning.

EOF
}

# Validate dependencies
check_dependencies() {
    local deps=("kubectl" "virtctl")
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            log_error "Required dependency '$dep' not found"
            exit 1
        fi
    done
}

# Validate session exists
validate_session() {
    local session_id="$1"
    local namespace="user-session-${session_id}"
    
    log_info "Validating session ${session_id}..."
    
    # Check if namespace exists
    if ! kubectl get namespace "$namespace" &> /dev/null; then
        log_error "Session namespace '$namespace' not found"
        exit 1
    fi
    
    # Check if VMs exist
    local control_plane_vm="cks-control-plane-user-session-${session_id}"
    local worker_vm="cks-worker-node-user-session-${session_id}"
    
    if ! kubectl get vm "$control_plane_vm" -n "$namespace" &> /dev/null; then
        log_error "Control plane VM '$control_plane_vm' not found in namespace '$namespace'"
        exit 1
    fi
    
    if ! kubectl get vm "$worker_vm" -n "$namespace" &> /dev/null; then
        log_error "Worker VM '$worker_vm' not found in namespace '$namespace'"
        exit 1
    fi
    
    log_success "Session ${session_id} validated successfully"
}

# Check VM status
get_vm_status() {
    local vm_name="$1"
    local namespace="$2"
    
    kubectl get vm "$vm_name" -n "$namespace" -o jsonpath='{.spec.running}' 2>/dev/null || echo "false"
}

# Stop VM gracefully
stop_vm() {
    local vm_name="$1"
    local namespace="$2"
    
    log_info "Stopping VM ${vm_name}..."
    
    # Check if VM is running
    local is_running=$(get_vm_status "$vm_name" "$namespace")
    
    if [[ "$is_running" == "true" ]]; then
        # Stop the VM
        kubectl patch vm "$vm_name" -n "$namespace" --type='merge' -p='{"spec":{"running":false}}'
        
        # Wait for VM to stop
        local timeout=60
        local count=0
        while [[ "$(get_vm_status "$vm_name" "$namespace")" == "true" ]] && [[ $count -lt $timeout ]]; do
            sleep 2
            ((count+=2))
            echo -n "."
        done
        echo
        
        if [[ "$(get_vm_status "$vm_name" "$namespace")" == "true" ]]; then
            log_error "VM ${vm_name} failed to stop within ${timeout} seconds"
            return 1
        fi
        
        log_success "VM ${vm_name} stopped successfully"
    else
        log_info "VM ${vm_name} is already stopped"
    fi
}

# Start VM
start_vm() {
    local vm_name="$1"
    local namespace="$2"
    
    log_info "Starting VM ${vm_name}..."
    
    kubectl patch vm "$vm_name" -n "$namespace" --type='merge' -p='{"spec":{"running":true}}'
    
    # Wait for VM to start
    local timeout=120
    local count=0
    while [[ "$(get_vm_status "$vm_name" "$namespace")" != "true" ]] && [[ $count -lt $timeout ]]; do
        sleep 2
        ((count+=2))
        echo -n "."
    done
    echo
    
    if [[ "$(get_vm_status "$vm_name" "$namespace")" != "true" ]]; then
        log_error "VM ${vm_name} failed to start within ${timeout} seconds"
        return 1
    fi
    
    log_success "VM ${vm_name} started successfully"
}

# Create VM snapshot with wait
create_snapshot() {
    local vm_name="$1"
    local namespace="$2"
    local snapshot_name="$3"
    
    log_info "Creating snapshot ${snapshot_name} from VM ${vm_name}..."
    
    # Create the snapshot YAML
    cat << EOF | kubectl apply -f -
apiVersion: snapshot.kubevirt.io/v1beta1
kind: VirtualMachineSnapshot
metadata:
  name: ${snapshot_name}
  namespace: ${namespace}
  labels:
    cks.io/snapshot-type: "base"
    cks.io/source-session: "$(echo "$namespace" | sed 's/user-session-//')"
spec:
  source:
    apiGroup: kubevirt.io
    kind: VirtualMachine
    name: ${vm_name}
EOF
    
    if [[ $? -eq 0 ]]; then
        log_success "Snapshot ${snapshot_name} creation initiated in namespace ${namespace}"
        
        # Wait for snapshot to be ready
        log_info "Waiting for snapshot ${snapshot_name} to be ready..."
        kubectl wait vmsnapshot ${snapshot_name} -n ${namespace} --for condition=Ready --timeout=600s
        
        if [[ $? -eq 0 ]]; then
            log_success "Snapshot ${snapshot_name} is ready"
        else
            log_error "Snapshot ${snapshot_name} failed to become ready"
            return 1
        fi
    else
        log_error "Failed to create snapshot ${snapshot_name}"
        return 1
    fi
}

# Create VM from snapshot using Clone API - the correct KubeVirt way
create_vm_from_snapshot() {
    local snapshot_name="$1"
    local source_namespace="$2"
    local target_namespace="$3"
    local new_vm_name="$4"
    
    log_info "Creating VM ${new_vm_name} from snapshot ${snapshot_name} using Clone API..."
    
    # Create a Clone object that references the snapshot
    cat << EOF | kubectl apply -f -
apiVersion: clone.kubevirt.io/v1alpha1
kind: VirtualMachineClone
metadata:
  name: clone-${new_vm_name}
spec:
  source:
    apiGroup: snapshot.kubevirt.io
    kind: VirtualMachineSnapshot
    name: ${snapshot_name}
  target:
    apiGroup: kubevirt.io
    kind: VirtualMachine
    name: ${new_vm_name}
EOF
    
    if [[ $? -eq 0 ]]; then
        log_success "VirtualMachineClone created for ${new_vm_name}"
        
        # Wait for clone to complete
        log_info "Waiting for clone to complete..."
        if kubectl wait vmclone clone-${new_vm_name} -n ${target_namespace} --for condition=Ready --timeout=600s; then
            log_success "VM ${new_vm_name} cloned successfully to ${target_namespace}"
            
            # Cleanup the clone object
            kubectl delete vmclone clone-${new_vm_name} -n ${target_namespace}
            log_info "Clone object cleaned up"
            
            return 0
        else
            log_error "VM clone failed for ${new_vm_name}"
            kubectl describe vmclone clone-${new_vm_name} -n ${target_namespace}
            return 1
        fi
    else
        log_error "Failed to create VirtualMachineClone for ${new_vm_name}"
        return 1
    fi
}

# Create final snapshot in vm-templates namespace
create_final_snapshot() {
    local vm_name="$1"
    local namespace="$2"
    local snapshot_name="$3"
    
    log_info "Creating final snapshot ${snapshot_name} from VM ${vm_name} in ${namespace}..."
    
    cat << EOF | kubectl apply -f -
apiVersion: snapshot.kubevirt.io/v1beta1
kind: VirtualMachineSnapshot
metadata:
  name: ${snapshot_name}
  namespace: ${namespace}
  labels:
    cks.io/snapshot-type: "base"
    cks.io/template: "true"
spec:
  source:
    apiGroup: kubevirt.io
    kind: VirtualMachine
    name: ${vm_name}
EOF
    
    if [[ $? -eq 0 ]]; then
        log_success "Final snapshot ${snapshot_name} creation initiated"
        
        # Wait for snapshot to be ready
        log_info "Waiting for final snapshot ${snapshot_name} to be ready..."
        kubectl wait vmsnapshot ${snapshot_name} -n ${namespace} --for condition=Ready --timeout=600s
        
        if [[ $? -eq 0 ]]; then
            log_success "Final snapshot ${snapshot_name} is ready"
        else
            log_error "Final snapshot ${snapshot_name} failed to become ready"
            return 1
        fi
    else
        log_error "Failed to create final snapshot ${snapshot_name}"
        return 1
    fi
}

# Create vm-templates namespace if it doesn't exist
ensure_vm_templates_namespace() {
    if ! kubectl get namespace vm-templates &> /dev/null; then
        log_info "Creating vm-templates namespace..."
        kubectl create namespace vm-templates
        kubectl label namespace vm-templates cks.io/snapshots=true
        log_success "vm-templates namespace created"
    else
        log_info "vm-templates namespace already exists"
    fi
}

# Enhanced cleanup function for error cases
cleanup_on_error() {
    local session_id="$1"
    local namespace="user-session-${session_id}"
    local control_plane_vm="cks-control-plane-user-session-${session_id}"
    local worker_vm="cks-worker-node-user-session-${session_id}"
    local vm_templates_ns="vm-templates"
    
    log_warn "Cleaning up after error..."
    
    # Try to restart VMs if they were stopped
    start_vm "$control_plane_vm" "$namespace" || true
    start_vm "$worker_vm" "$namespace" || true
    
    # Cleanup partial snapshots
    kubectl delete vmsnapshot cks-control-plane-base-snapshot -n "$vm_templates_ns" 2>/dev/null || true
    kubectl delete vmsnapshot cks-worker-base-snapshot -n "$vm_templates_ns" 2>/dev/null || true
    kubectl delete vmsnapshot temp-control-plane-snapshot -n "$namespace" 2>/dev/null || true
    kubectl delete vmsnapshot temp-worker-snapshot -n "$namespace" 2>/dev/null || true
    
    # Cleanup clone objects
    kubectl delete vmclone clone-cks-control-plane-base -n "$vm_templates_ns" 2>/dev/null || true
    kubectl delete vmclone clone-cks-worker-base -n "$vm_templates_ns" 2>/dev/null || true
    
    # Cleanup template VMs
    kubectl delete vm cks-control-plane-base -n "$vm_templates_ns" 2>/dev/null || true
    kubectl delete vm cks-worker-base -n "$vm_templates_ns" 2>/dev/null || true
}


# Updated main function using Clone API approach
main() {
    local session_id="$1"
    local namespace="user-session-${session_id}"
    local control_plane_vm="cks-control-plane-user-session-${session_id}"
    local worker_vm="cks-worker-node-user-session-${session_id}"
    local vm_templates_ns="vm-templates"
    
    log_info "Starting snapshot creation for session: ${session_id}"
    
    # Set trap for cleanup on error
    trap 'cleanup_on_error "$session_id"' ERR
    
    # Validate session
    validate_session "$session_id"
    
    # Ensure target namespace exists
    ensure_vm_templates_namespace
    
    # Delete existing snapshots and VMs if they exist
    log_info "Cleaning up existing snapshots and template VMs..."
    kubectl delete vmsnapshot cks-control-plane-base-snapshot -n "$vm_templates_ns" 2>/dev/null || true
    kubectl delete vmsnapshot cks-worker-base-snapshot -n "$vm_templates_ns" 2>/dev/null || true
    kubectl delete vm cks-control-plane-base -n "$vm_templates_ns" 2>/dev/null || true
    kubectl delete vm cks-worker-base -n "$vm_templates_ns" 2>/dev/null || true
    kubectl delete vmclone clone-cks-control-plane-base -n "$vm_templates_ns" 2>/dev/null || true
    kubectl delete vmclone clone-cks-worker-base -n "$vm_templates_ns" 2>/dev/null || true
    kubectl delete vmsnapshot temp-control-plane-snapshot -n "$namespace" 2>/dev/null || true
    kubectl delete vmsnapshot temp-worker-snapshot -n "$namespace" 2>/dev/null || true
    
    # Stop VMs for consistent snapshots
    stop_vm "$control_plane_vm" "$namespace"
    stop_vm "$worker_vm" "$namespace"
    
    # Create initial snapshots in the session namespace
    create_snapshot "$control_plane_vm" "$namespace" "temp-control-plane-snapshot"
    create_snapshot "$worker_vm" "$namespace" "temp-worker-snapshot"
    
    # Start VMs back up
    start_vm "$control_plane_vm" "$namespace"
    start_vm "$worker_vm" "$namespace"
    
    log_info "Initial snapshots created successfully!"
    echo
    
    # Create VMs in vm-templates namespace using Clone API
    log_info "Creating template VMs from snapshots using Clone API..."
    create_vm_from_snapshot "temp-control-plane-snapshot" "$namespace" "$vm_templates_ns" "cks-control-plane-base"
    create_vm_from_snapshot "temp-worker-snapshot" "$namespace" "$vm_templates_ns" "cks-worker-base"
    
    # Create final snapshots with standard names
    log_info "Creating final snapshots with standard names..."
    create_final_snapshot "cks-control-plane-base" "$vm_templates_ns" "cks-control-plane-base-snapshot"
    create_final_snapshot "cks-worker-base" "$vm_templates_ns" "cks-worker-base-snapshot"
    
    # Cleanup temporary snapshots
    log_info "Cleaning up temporary snapshots..."
    kubectl delete vmsnapshot temp-control-plane-snapshot -n "$namespace" || true
    kubectl delete vmsnapshot temp-worker-snapshot -n "$namespace" || true
    
    # Cleanup template VMs after snapshots are created
    log_info "Cleaning up template VMs..."
    kubectl delete vm cks-control-plane-base -n "$vm_templates_ns" || true
    kubectl delete vm cks-worker-base -n "$vm_templates_ns" || true
    
    # Show final status
    log_success "All snapshots created successfully!"
    echo
    log_info "Final snapshots in vm-templates namespace:"
    kubectl get vmsnapshot -n "$vm_templates_ns" -o custom-columns="NAME:.metadata.name,READY:.status.readyToUse,PHASE:.status.phase,AGE:.metadata.creationTimestamp"
    echo
    
    echo
    log_success "Session ${session_id} snapshots are ready for fast provisioning!"
    log_info "These snapshots will be used automatically for future session creation"
    
    # Disable cleanup trap since we succeeded
    trap - ERR
}

# Script entry point
if [[ $# -ne 1 ]]; then
    usage
    exit 1
fi

# Check dependencies
check_dependencies

# Run main function
main "$1"