#!/bin/bash
# build-golden-image.sh - Script to create a golden image for CKS practice environment

set -e

# Configuration
K8S_VERSION="1.33.0"
OUTPUT_IMAGE="ubuntu-2204-k8s-golden-image.qcow2"
BASE_IMAGE="ubuntu-22.04-server-cloudimg-amd64.img"
TEMP_DIR=$(mktemp -d)
MOUNT_DIR="${TEMP_DIR}/mnt"
HTTP_SERVER_PORT=8000
PVC_NAME="golden-image-${K8S_VERSION//./-}"
NAMESPACE="vm-templates"

echo "Creating golden VM image for Kubernetes ${K8S_VERSION}..."

# Check if base image exists
if [ ! -f "${BASE_IMAGE}" ]; then
    echo "Downloading base Ubuntu image..."
    wget -q "https://cloud-images.ubuntu.com/releases/22.04/release/${BASE_IMAGE}"
fi

# Create a copy of the base image
cp "${BASE_IMAGE}" "${OUTPUT_IMAGE}"

# Resize the image to have enough space
qemu-img resize "${OUTPUT_IMAGE}" +20G

# Install necessary tools for image manipulation
sudo dnf update
sudo dnf install virt-manager qemu-kvm libvirt libguestfs-tools libguestfs-tools-c

# Create mount directory
mkdir -p "${MOUNT_DIR}"

echo "Customizing image..."

# Use virt-customize to modify the image
virt-customize -a "${OUTPUT_IMAGE}" \
  --update \
  --install apt-transport-https,ca-certificates,curl,gnupg,lsb-release,net-tools,ipvsadm,jq,ncat,vim,nano,software-properties-common,cloud-utils \
  --run-command "mount" \
  --run-command "growpart /dev/sda 1" \
  --run-command "resize2fs /dev/sda1" \
  --run-command "modprobe overlay || true" \
  --run-command "modprobe br_netfilter || true" \
  --run-command "echo 'overlay' > /etc/modules-load.d/containerd.conf" \
  --run-command "echo 'br_netfilter' >> /etc/modules-load.d/containerd.conf" \
  --run-command "echo 'net.bridge.bridge-nf-call-iptables = 1' > /etc/sysctl.d/99-kubernetes-cri.conf" \
  --run-command "echo 'net.bridge.bridge-nf-call-ip6tables = 1' >> /etc/sysctl.d/99-kubernetes-cri.conf" \
  --run-command "echo 'net.ipv4.ip_forward = 1' >> /etc/sysctl.d/99-kubernetes-cri.conf" \
  --run-command "sysctl --system || true" \
  --run-command "install -m 0755 -d /etc/apt/keyrings" \
  --run-command "curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc" \
  --run-command "chmod a+r /etc/apt/keyrings/docker.asc" \
  --run-command "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg" \
  --run-command "echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \$(lsb_release -cs) stable\" | tee /etc/apt/sources.list.d/docker.list > /dev/null" \
  --run-command "apt-get update" \
  --run-command "apt-get install -y containerd.io" \
  --run-command "mkdir -p /etc/containerd" \
  --run-command "containerd config default > /etc/containerd/config.toml" \
  --run-command "sed -i 's/SystemdCgroup = false/SystemdCgroup = true/g' /etc/containerd/config.toml" \
  --run-command "sed -i 's|sandbox_image = \"registry.k8s.io/pause:3.8\"|sandbox_image = \"registry.k8s.io/pause:3.10\"|g' /etc/containerd/config.toml" \
  --run-command "systemctl enable containerd" \
  --run-command "curl -fsSL https://pkgs.k8s.io/core:/stable:/v${K8S_VERSION%.*}/deb/Release.key | gpg --dearmor -o /etc/apt/trusted.gpg.d/k8s.gpg" \
  --run-command "echo \"deb [signed-by=/etc/apt/trusted.gpg.d/k8s.gpg] https://pkgs.k8s.io/core:/stable:/v${K8S_VERSION%.*}/deb/ /\" | tee /etc/apt/sources.list.d/kubernetes.list" \
  --run-command "apt-get update" \
  --run-command "apt-get install -y kubelet=${K8S_VERSION}-1.1 kubeadm=${K8S_VERSION}-1.1 kubectl=${K8S_VERSION}-1.1" \
  --run-command "apt-mark hold kubelet kubeadm kubectl" \
  --run-command "curl -L -o /tmp/kube-bench.deb https://github.com/aquasecurity/kube-bench/releases/download/v0.10.1/kube-bench_0.10.1_linux_amd64.deb" \
  --run-command "dpkg -i /tmp/kube-bench.deb" \
  --run-command "rm /tmp/kube-bench.deb" \
  --run-command "swapoff -a" \
  --run-command "sed -i '/swap/s/^/#/' /etc/fstab" \
  --run-command "useradd suporte" \
  --run-command "mkdir -p /home/suporte/.kube" \
  --run-command "chown -R suporte:suporte /home/suporte/.kube" \
  --run-command "echo 'suporte ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/suporte" \
  --ssh-inject suporte:file:/home/pedro/.ssh/id_ed25519.pub \
  --root-password password:suporte

echo "Golden image created: ${OUTPUT_IMAGE}"

# Get local IP address
LOCAL_IP=$(ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '127.0.0.1' | head -n 1)
if [ -z "$LOCAL_IP" ]; then
    echo "Error: Could not determine local IP address"
    exit 1
fi

echo "Starting HTTP server to serve the image file..."
# Start a temporary HTTP server in the background
cd $(dirname "${OUTPUT_IMAGE}")
python3 -m http.server $HTTP_SERVER_PORT &
HTTP_SERVER_PID=$!

# Make sure to kill the HTTP server when the script exits
trap "kill $HTTP_SERVER_PID" EXIT

echo "HTTP server started at http://$LOCAL_IP:$HTTP_SERVER_PORT"
echo "Importing image to KubeVirt using DataVolume..."

# Create a DataVolume that imports from the HTTP server
cat <<EOF | kubectl apply -f -
apiVersion: cdi.kubevirt.io/v1beta1
kind: DataVolume
metadata:
  name: ${PVC_NAME}
  namespace: ${NAMESPACE}
spec:
  pvc:
    accessModes:
      - ReadWriteOnce
    resources:
      requests:
        storage: 20Gi
    storageClassName: local-path
  source:
    http:
      url: "http://${LOCAL_IP}:${HTTP_SERVER_PORT}/$(basename ${OUTPUT_IMAGE})"
EOF
echo "DataVolume created. Waiting for import to complete..."

# Kickstart datavolume
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: trigger-provisioning
  namespace: ${NAMESPACE}
spec:
  volumes:
  - name: data
    persistentVolumeClaim:
      claimName: ${PVC_NAME} 
  containers:
  - name: dummy
    image: busybox
    command: ["sleep", "30"]
    volumeMounts:
    - name: data
      mountPath: /data
  restartPolicy: Never
EOF


# Wait for DataVolume to complete
kubectl wait datavolume/${PVC_NAME} --namespace=${NAMESPACE} --for=condition=Ready --timeout=30m

echo "Import completed. Golden image ready for use."

# Cleanup
kill $HTTP_SERVER_PID
rm -rf "${TEMP_DIR}"
echo "Temporary HTTP server stopped."