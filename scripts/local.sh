# envs necessary to test running front+back locally connecting to the kubevirt cluster instead of living inside the cluster
export ENVIRONMENT=development && export LOG_LEVEL=debug && export KUBECONFIG=/home/pedro/.kube/config && export KUBERNETES_SERVICE_PORT=6443 && export KUBERNETES_SERVICE_HOST=https://192.168.1.21 && go build -o /home/pedro/repos/cks/cks-backend /home/pedro/repos/cks/backend/cmd/server && /home/pedro/repos/cks/cks-backend

# Function to remove session VMs and NS on KubeVirt cluster
cksclean() {
    kubectl delete -n cluster1 vm/wk-cluster1
    kubectl delete -n cluster1 vm/cp-cluster1
    kubectl delete -n cluster1 datavolume/wk-cluster1
    kubectl delete -n cluster1 datavolume/cp-cluster1
    kubectl delete ns cluster1
    kubectl delete -n cluster2 vm/wk-cluster2
    kubectl delete -n cluster2 vm/cp-cluster2
    kubectl delete -n cluster2 datavolume/wk-cluster2
    kubectl delete -n cluster2 datavolume/cp-cluster2
    kubectl delete ns cluster2
    kubectl delete -n cluster3 vm/wk-cluster3
    kubectl delete -n cluster3 vm/cp-cluster3
    kubectl delete -n cluster3 datavolume/wk-cluster3
    kubectl delete -n cluster3 datavolume/cp-cluster3
    kubectl delete ns cluster3

}

cksconsole() {
    if [[ "$1" == "w" ]]; then
        virtctl console -n cluster"$2" wk-cluster"$2"
    elif [[ "$1" == "c" ]]; then
        virtctl console -n cluster"$2" cp-cluster"$2"
    else
        echo "Usage: cksconsole [w|c] <node_id>"
    fi
}

cksssh() {
    if [[ "$1" == "w" ]]; then
        virtctl ssh wk-cluster"$2" -n cluster"$2" -l suporte
    elif [[ "$1" == "c" ]]; then
        virtctl ssh cp-cluster"$2" -n cluster"$2" -l suporte
    else
        echo "Usage: cksssh [w|c] <node_id>"
    fi
}