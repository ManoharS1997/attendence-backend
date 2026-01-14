#!/bin/bash
set -e

echo "🚀 Deploying attendance backend..."

docker stop attendance-backend-container || true
docker rm attendance-backend-container || true

docker run -d \
  --name attendance-backend-container \
  -p 5000:5000 \
  -e PORT=5000 \
  -e NODE_ENV=production \
  -e MONGO_URI="$MONGO_URI" \
  -e JWT_SECRET="$JWT_SECRET" \
  -e DEFAULT_ADMIN_EMAIL="admin@nowitservices.com" \
  -e DEFAULT_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e DEFAULT_MANAGER_EMAIL="manager@nowitservices.com" \
  -e DEFAULT_MANAGER_PASSWORD="$MANAGER_PASSWORD" \
  --restart always \
  attendance-backend

echo "✅ Deployment completed"
