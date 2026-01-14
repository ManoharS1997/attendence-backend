#!/bin/bash

echo "⏪ Rolling back deployment..."

docker stop attendance-backend-container || true
docker rm attendance-backend-container || true

docker run -d \
  --name attendance-backend-container \
  -p 5000:5000 \
  --restart always \
  attendance-backend:previous

echo "✅ Rollback completed"
