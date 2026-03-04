#!/bin/bash
# ============================================================
# BuddyCoach GPU EC2 Deployment Script
# Usage: bash deploy_to_gpu.sh <GPU_INSTANCE_IP>
#
# Run this from your Mac AFTER launching the g4dn.xlarge instance.
# This script will:
#   1. Copy the backend code to EC2
#   2. Install all dependencies (PyTorch, Detectron2, FastAPI)
#   3. Download VideoPose3D pretrained model
#   4. Set up environment variables
#   5. Create a systemd service for auto-start
# ============================================================

set -e

GPU_IP="${1}"
if [ -z "$GPU_IP" ]; then
  echo "Usage: bash deploy_to_gpu.sh <GPU_INSTANCE_IP>"
  exit 1
fi

KEY="$HOME/.ssh/buddycoach-key.pem"
SSH_USER="ubuntu"
REMOTE="$SSH_USER@$GPU_IP"
REMOTE_DIR="/home/ubuntu/buddycoach"

echo "=========================================="
echo " Deploying BuddyCoach backend to GPU EC2"
echo " IP: $GPU_IP"
echo "=========================================="

# ── 1. Wait for SSH to be ready ────────────────────────────────────────────────
echo ""
echo "=== Waiting for SSH to be ready ==="
for i in $(seq 1 30); do
  if ssh -i "$KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
    "$REMOTE" "echo ok" 2>/dev/null; then
    echo "SSH ready!"
    break
  fi
  echo "  attempt $i/30 — waiting..."
  sleep 10
done

# ── 2. Sync backend code ───────────────────────────────────────────────────────
echo ""
echo "=== Syncing backend code ==="
rsync -avz --progress \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  --exclude '**/__pycache__' \
  --exclude 'venv/' \
  --exclude '*.pyc' \
  "/Users/abindevassia/DS/motion capture/app/buddycoach/back_end/" \
  "$REMOTE:$REMOTE_DIR/"

# ── 3. Collect AWS credentials from local config ───────────────────────────────
AWS_KEY_ID=$(aws configure get aws_access_key_id)
AWS_SECRET=$(aws configure get aws_secret_access_key)
AWS_REGION=$(aws configure get region || echo "us-east-1")

# Fetch secrets from Parameter Store (or use defaults)
SECRET_KEY=$(aws ssm get-parameter --name "/buddycoach/SECRET_KEY" \
  --with-decryption --query Parameter.Value --output text 2>/dev/null \
  || openssl rand -hex 32)
DB_PASSWORD=$(aws ssm get-parameter --name "/buddycoach/DB_PASSWORD" \
  --with-decryption --query Parameter.Value --output text 2>/dev/null \
  || echo "buddycoach_db_pass")
DB_ENDPOINT=$(aws rds describe-db-instances \
  --query "DBInstances[?DBInstanceIdentifier=='buddycoach'].Endpoint.Address" \
  --output text 2>/dev/null || echo "localhost")
S3_BUCKET=$(aws s3api list-buckets \
  --query "Buckets[?starts_with(Name, 'buddycoach')].Name" \
  --output text 2>/dev/null | head -1 || echo "buddycoach-videos")

echo "  AWS Region: $AWS_REGION"
echo "  S3 Bucket:  $S3_BUCKET"
echo "  DB Endpoint: $DB_ENDPOINT"

# ── 4. Run remote setup ────────────────────────────────────────────────────────
echo ""
echo "=== Running remote setup (this may take 10-20 min for Detectron2) ==="

ssh -i "$KEY" -o StrictHostKeyChecking=no "$REMOTE" bash -s << REMOTE_SCRIPT
set -e

echo "--- [1/7] System packages ---"
sudo apt-get update -q
sudo apt-get install -y -q ffmpeg git python3-pip python3-venv libgl1 wget build-essential

echo "--- [2/7] Python virtual environment ---"
# Create dedicated venv
if [ ! -d ~/buddycoach_venv ]; then
  python3 -m venv ~/buddycoach_venv
  echo "  venv created"
fi
source ~/buddycoach_venv/bin/activate

echo "--- [3/7] PyTorch + CUDA ---"
pip install -q torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

echo "--- [4/7] Detectron2 ---"
python -c "import detectron2" 2>/dev/null && echo "  detectron2 already installed" || \
  pip install -q 'git+https://github.com/facebookresearch/detectron2.git'

echo "--- [5/7] FastAPI backend dependencies ---"
pip install -r $REMOTE_DIR/requirements.txt -q
pip install opencv-python-headless -q

echo "--- [6/7] VideoPose3D model ---"
POSE_DIR=/home/ubuntu/videopose3d
mkdir -p \$POSE_DIR
if [ ! -d "\$POSE_DIR/VideoPose3D" ]; then
  git clone https://github.com/facebookresearch/VideoPose3D.git \$POSE_DIR/VideoPose3D -q
  echo "  Repo cloned"
else
  echo "  SKIP: repo already present"
fi

mkdir -p \$POSE_DIR/VideoPose3D/checkpoint
CKPT="\$POSE_DIR/VideoPose3D/checkpoint/pretrained_h36m_detectron_coco.bin"
if [ ! -f "\$CKPT" ]; then
  echo "  Downloading pretrained model (this may take a while)..."
  wget -q https://dl.fbaipublicfiles.com/video-pose-3d/pretrained_h36m_detectron_coco.bin -O \$CKPT
  echo "  Pretrained model downloaded"
else
  echo "  SKIP: pretrained model already present"
fi

echo "--- [7/7] Environment file ---"
cat > $REMOTE_DIR/.env << ENVEOF
JWT_SECRET=${SECRET_KEY}
DATABASE_URL=mysql+pymysql://buddycoach:${DB_PASSWORD}@${DB_ENDPOINT}/buddycoach
AWS_ACCESS_KEY_ID=${AWS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET}
AWS_REGION=${AWS_REGION}
AWS_S3_BUCKET=${S3_BUCKET}
POSE_WORK_DIR=/home/ubuntu/videopose3d
ENVEOF

echo "  .env written"

echo "--- [systemd] Creating buddycoach service ---"
VENV_PYTHON=/home/ubuntu/buddycoach_venv/bin/python

sudo tee /etc/systemd/system/buddycoach.service > /dev/null << SVCEOF
[Unit]
Description=BuddyCoach FastAPI backend
After=network.target

[Service]
User=ubuntu
WorkingDirectory=$REMOTE_DIR
EnvironmentFile=$REMOTE_DIR/.env
ExecStart=/home/ubuntu/buddycoach_venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable buddycoach
sudo systemctl restart buddycoach

echo ""
echo "=== Waiting for FastAPI to start ==="
sleep 8
if curl -s --max-time 5 http://localhost:8000/docs > /dev/null; then
  echo "✅ Backend is running!"
else
  echo "⚠️  Backend may still be starting. Check: sudo journalctl -u buddycoach -n 50"
fi

REMOTE_SCRIPT

# ── 5. Print summary ───────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo " DEPLOYMENT COMPLETE"
echo "=========================================="
echo ""
echo " GPU Instance IP : $GPU_IP"
echo " API Docs        : http://$GPU_IP:8000/docs"
echo ""
echo " Now update client/src/api/api.ts:"
echo "   const EC2_URL = \"http://$GPU_IP:8000\";"
echo "   const USE_EC2 = true;"
echo ""
echo " To check logs:"
echo "   ssh -i $KEY $REMOTE 'sudo journalctl -u buddycoach -f'"
echo ""
echo " To test the API:"
echo "   curl http://$GPU_IP:8000/health"
