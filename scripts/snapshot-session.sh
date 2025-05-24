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

# Create VM snapshot
create_snapshot() {
    local vm_name="$1"
    local namespace="$2"
    local snapshot_name="$3"
    local target_namespace="$4"
    
    log_info "Creating snapshot ${snapshot_name} from VM ${vm_name}..."
    
    # Create the snapshot YAML with correct cross-namespace reference
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
    else
        log_error "Failed to create snapshot ${snapshot_name}"
        return 1
    fi
}

copy_snapshot_to_templates() {
    local snapshot_name="$1"
    local source_namespace="$2"
    local target_namespace="$3"
    
    log_info "Copying snapshot ${snapshot_name} to ${target_namespace} namespace..."
    
    # Wait for source snapshot to be ready first
    wait_for_snapshot "$snapshot_name" "$source_namespace" 600
    
    # Get the snapshot content and recreate in target namespace
    local snapshot_content=$(kubectl get vmsnapshot "$snapshot_name" -n "$source_namespace" -o yaml)
    
    # Modify the YAML for target namespace
    echo "$snapshot_content" | \
    sed "s/namespace: ${source_namespace}/namespace: ${target_namespace}/" | \
    sed '/resourceVersion:/d' | \
    sed '/uid:/d' | \
    sed '/creationTimestamp:/d' | \
    sed '/generation:/d' | \
    kubectl apply -f -
    
    if [[ $? -eq 0 ]]; then
        log_success "Snapshot ${snapshot_name} copied to ${target_namespace}"
    else
        log_error "Failed to copy snapshot ${snapshot_name} to ${target_namespace}"
        return 1
    fi
}

# Wait for snapshot to be ready
wait_for_snapshot() {
    local snapshot_name="$1"
    local namespace="$2"
    local timeout="${3:-600}" # 10 minutes default
    
    log_info "Waiting for snapshot ${snapshot_name} to be ready (timeout: ${timeout}s)..."
    
    local count=0
    while [[ $count -lt $timeout ]]; do
        local ready=$(kubectl get vmsnapshot "$snapshot_name" -n "$namespace" -o jsonpath='{.status.readyToUse}' 2>/dev/null || echo "false")
        
        if [[ "$ready" == "true" ]]; then
            log_success "Snapshot ${snapshot_name} is ready"
            return 0
        fi
        
        # Show progress every 30 seconds
        if [[ $((count % 30)) -eq 0 ]] && [[ $count -gt 0 ]]; then
            local phase=$(kubectl get vmsnapshot "$snapshot_name" -n "$namespace" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
            log_info "Snapshot ${snapshot_name} status: ${phase} (${count}s elapsed)"
        fi
        
        sleep 5
        ((count+=5))
        echo -n "."
    done
    echo
    
    log_error "Snapshot ${snapshot_name} not ready within ${timeout} seconds"
    return 1
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

# Cleanup function for error cases
cleanup_on_error() {
    local session_id="$1"
    local namespace="user-session-${session_id}"
    local control_plane_vm="cks-control-plane-user-session-${session_id}"
    local worker_vm="cks-worker-node-user-session-${session_id}"
    
    log_warn "Cleaning up after error..."
    
    # Try to restart VMs if they were stopped
    start_vm "$control_plane_vm" "$namespace" || true
    start_vm "$worker_vm" "$namespace" || true
    
    # Optionally cleanup partial snapshots
    kubectl delete vmsnapshot cks-control-plane-base-snapshot -n vm-templates 2>/dev/null || true
    kubectl delete vmsnapshot cks-worker-base-snapshot -n vm-templates 2>/dev/null || true
}

# Main function
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
    
    # Delete existing snapshots if they exist (in both namespaces)
    log_info "Cleaning up existing snapshots..."
    kubectl delete vmsnapshot cks-control-plane-base-snapshot -n "$namespace" 2>/dev/null || true
    kubectl delete vmsnapshot cks-worker-base-snapshot -n "$namespace" 2>/dev/null || true
    kubectl delete vmsnapshot cks-control-plane-base-snapshot -n "$vm_templates_ns" 2>/dev/null || true
    kubectl delete vmsnapshot cks-worker-base-snapshot -n "$vm_templates_ns" 2>/dev/null || true
    
    # Stop VMs for consistent snapshots
    stop_vm "$control_plane_vm" "$namespace"
    stop_vm "$worker_vm" "$namespace"
    
    # Create snapshots in the same namespace as the VMs
    create_snapshot "$control_plane_vm" "$namespace" "cks-control-plane-base-snapshot" "$namespace"
    create_snapshot "$worker_vm" "$namespace" "cks-worker-base-snapshot" "$namespace"
    
    # Start VMs back up
    start_vm "$control_plane_vm" "$namespace"
    start_vm "$worker_vm" "$namespace"
    
    # Wait for snapshots to be ready and copy to vm-templates
    copy_snapshot_to_templates "cks-control-plane-base-snapshot" "$namespace" "$vm_templates_ns" &
    local cp_pid=$!
    
    copy_snapshot_to_templates "cks-worker-base-snapshot" "$namespace" "$vm_templates_ns" &
    local worker_pid=$!
    
    # Wait for both copy operations
    local failed=0
    if ! wait $cp_pid; then
        log_error "Control plane snapshot copy failed"
        failed=1
    fi
    
    if ! wait $worker_pid; then
        log_error "Worker snapshot copy failed"
        failed=1
    fi
    
    if [[ $failed -eq 1 ]]; then
        log_error "One or more snapshot copies failed"
        exit 1
    fi
    
    # Show final status
    log_success "All snapshots created and copied successfully!"
    echo
    log_info "Snapshots in source namespace:"
    kubectl get vmsnapshot -n "$namespace" -o custom-columns="NAME:.metadata.name,READY:.status.readyToUse,PHASE:.status.phase,AGE:.metadata.creationTimestamp"
    echo
    log_info "Snapshots in vm-templates namespace:"
    kubectl get vmsnapshot -n "$vm_templates_ns" -o custom-columns="NAME:.metadata.name,READY:.status.readyToUse,PHASE:.status.phase,AGE:.metadata.creationTimestamp"
    
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