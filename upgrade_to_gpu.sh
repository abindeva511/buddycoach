#!/bin/bash
# ============================================================
# BuddyCoach: Upgrade EC2 to GPU instance (g4dn.xlarge)
# Run this AFTER AWS approves your GPU quota increase.
#
# To request quota increase:
#   1. Go to https://console.aws.amazon.com/servicequotas/home
#   2. Search "Running On-Demand G and VT instances"
#   3. Request increase to 8 vCPUs
#   4. Wait ~24hrs for approval, then run this script
# ============================================================

set -e

INSTANCE_ID="i-005095c8bfdd3afa5"
TARGET_TYPE="g4dn.xlarge"

echo "=== Stopping current instance ==="
aws ec2 stop-instances --instance-ids $INSTANCE_ID --output text
aws ec2 wait instance-stopped --instance-ids $INSTANCE_ID
echo "Instance stopped"

echo "=== Changing to $TARGET_TYPE ==="
aws ec2 modify-instance-attribute \
  --instance-id $INSTANCE_ID \
  --instance-type "{\"Value\": \"$TARGET_TYPE\"}"
echo "Instance type changed to $TARGET_TYPE"

echo "=== Starting instance ==="
aws ec2 start-instances --instance-ids $INSTANCE_ID --output text
aws ec2 wait instance-running --instance-ids $INSTANCE_ID

NEW_IP=$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text)

echo ""
echo "=== GPU INSTANCE LIVE ==="
echo "New IP: $NEW_IP"
echo ""
echo "Update client/src/api/api.ts:"
echo "  const EC2_URL = \"http://$NEW_IP:8000\";"
echo ""
echo "Test with:"
echo "  curl http://$NEW_IP:8000/docs"
