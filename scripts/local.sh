# envs necessary to test running front+back locally connecting to the kubevirt cluster instead of living inside the cluster
export ENVIRONMENT=development
export LOG_LEVEL=debug
export KUBECONFIG=/home/pedro/.kube/config
export KUBERNETES_SERVICE_PORT=6443
export KUBERNETES_SERVICE_HOST=https://192.168.1.21


# Function to remove session VMs and NS on KubeVirt cluster
cksclean() {
    kubectl delete -n user-session-"$1" vm/cks-worker-node-user-session-"$1"
    kubectl delete -n user-session-"$1" vm/cks-control-plane-user-session-"$1"
    kubectl delete -n user-session-"$1" datavolume/cks-worker-node-user-session-"$1"
    kubectl delete -n user-session-"$1" datavolume/cks-control-plane-user-session-"$1"
    kubectl delete ns user-session-"$1"
}

cksconsole() {
    if [[ "$1" == "w" ]]; then
        virtctl console -n user-session-"$2" cks-worker-node-user-session-"$2"
    elif [[ "$1" == "c" ]]; then
        virtctl console -n user-session-"$2" cks-control-plane-user-session-"$2"
    else
        echo "Usage: cksconsole [w|c] <node_id>"
    fi
}

cksssh() {
    if [[ "$1" == "w" ]]; then
        virtctl ssh cks-worker-node-user-session-"$2" -n user-session-"$2" -l suporte
    elif [[ "$1" == "c" ]]; then
        virtctl ssh cks-control-plane-user-session-"$2" -n user-session-"$2" -l suporte
    else
        echo "Usage: cksssh [w|c] <node_id>"
    fi
}