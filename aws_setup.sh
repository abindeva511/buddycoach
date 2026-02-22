#!/bin/bash
# AWS EC2 Setup Script for VideoPose3D
# Use this on an Ubuntu 22.04 GPU instance (g4dn.xlarge or p3.2xlarge)

set -e

echo "=== Updating system ==="
sudo apt-get update
sudo apt-get install -y ffmpeg git python3-pip python3-venv

echo "=== Installing CUDA (if not present) ==="
# Skip if using Deep Learning AMI which has CUDA pre-installed
if ! command -v nvcc &> /dev/null; then
    wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.0-1_all.deb
    sudo dpkg -i cuda-keyring_1.0-1_all.deb
    sudo apt-get update
    sudo apt-get -y install cuda
fi

echo "=== Setting up Python environment ==="
python3 -m venv ~/videopose_env
source ~/videopose_env/bin/activate

echo "=== Installing PyTorch with CUDA ==="
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

echo "=== Installing Detectron2 ==="
pip install 'git+https://github.com/facebookresearch/detectron2.git'

echo "=== Installing other dependencies ==="
pip install numpy pandas matplotlib opencv-python

echo "=== Cloning VideoPose3D ==="
cd ~
git clone https://github.com/facebookresearch/VideoPose3D.git
cd VideoPose3D

echo "=== Downloading pretrained model ==="
mkdir -p checkpoint
wget https://dl.fbaipublicfiles.com/video-pose-3d/pretrained_h36m_detectron_coco.bin \
     -O checkpoint/pretrained_h36m_detectron_coco.bin

echo "=== Creating directories ==="
mkdir -p ~/videos
mkdir -p ~/output_directory

echo "=== Setup complete! ==="
echo ""
echo "To process a video, run:"
echo "  source ~/videopose_env/bin/activate"
echo "  cd ~/VideoPose3D/inference"
echo "  python infer_video_d2.py --cfg COCO-Keypoints/keypoint_rcnn_R_101_FPN_3x.yaml --output-dir ~/output_directory --image-ext mp4 ~/videos"
echo ""
echo "Then run 3D pose estimation:"
echo "  cd ~/VideoPose3D"
echo "  python data/prepare_data_2d_custom.py -i ~/output_directory -o myvideos"
echo "  python run.py -d custom -k myvideos -arc 3,3,3,3,3 -c checkpoint --evaluate pretrained_h36m_detectron_coco.bin --render --viz-subject output.mp4 --viz-action custom --viz-camera 0 --viz-video ~/videos/output.mp4 --viz-output ~/output_3d.mp4 --viz-size 6"
