# envs necessary to test running front+back locally connecting to the kubevirt cluster instead of living inside the cluster
export ENVIRONMENT=development
export LOG_LEVEL=debug
export KUBECONFIG=/home/pedro/.kube/config
export KUBERNETES_SERVICE_PORT=6443
export KUBERNETES_SERVICE_HOST=https://192.168.1.21


