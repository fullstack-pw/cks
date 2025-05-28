# envs necessary to test running front+back locally connecting to the kubevirt cluster instead of living inside the cluster
export ENVIRONMENT=development && export LOG_LEVEL=debug && export KUBECONFIG=/home/pedro/.kube/config && export KUBERNETES_SERVICE_PORT=6443 && export KUBERNETES_SERVICE_HOST=https://192.168.1.21 && go build -o /home/pedro/repos/cks/cks-backend /home/pedro/repos/cks/backend/cmd/server && /home/pedro/repos/cks/cks-backend

# Function to remove session VMs and NS on KubeVirt cluster
cksclean() {
    kubectl delete -n cluster1 vm/cks-worker-node-cluster1
    kubectl delete -n cluster1 vm/cks-control-plane-cluster1
    kubectl delete -n cluster1 datavolume/cks-worker-node-cluster1
    kubectl delete -n cluster1 datavolume/cks-control-plane-cluster1
    kubectl delete ns cluster1
    kubectl delete -n cluster2 vm/cks-worker-node-cluster2
    kubectl delete -n cluster2 vm/cks-control-plane-cluster2
    kubectl delete -n cluster2 datavolume/cks-worker-node-cluster2
    kubectl delete -n cluster2 datavolume/cks-control-plane-cluster2
    kubectl delete ns cluster2
    kubectl delete -n cluster3 vm/cks-worker-node-cluster3
    kubectl delete -n cluster3 vm/cks-control-plane-cluster3
    kubectl delete -n cluster3 datavolume/cks-worker-node-cluster3
    kubectl delete -n cluster3 datavolume/cks-control-plane-cluster3
    kubectl delete ns cluster3

}

cksconsole() {
    if [[ "$1" == "w" ]]; then
        virtctl console -n cluster"$2" cks-worker-node-cluster"$2"
    elif [[ "$1" == "c" ]]; then
        virtctl console -n cluster"$2" cks-control-plane-cluster"$2"
    else
        echo "Usage: cksconsole [w|c] <node_id>"
    fi
}

cksssh() {
    if [[ "$1" == "w" ]]; then
        virtctl ssh cks-worker-node-cluster"$2" -n cluster"$2" -l suporte
    elif [[ "$1" == "c" ]]; then
        virtctl ssh cks-control-plane-cluster"$2" -n cluster"$2" -l suporte
    else
        echo "Usage: cksssh [w|c] <node_id>"
    fi
}