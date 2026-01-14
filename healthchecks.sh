#!/bin/bash
set -e

URL="http://localhost:5000/health"
RETRIES=10

echo "🔍 Running health checks..."

for i in $(seq 1 $RETRIES); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" $URL)

  if [ "$STATUS" == "200" ]; then
    echo "✅ Application is healthy"
    exit 0
  fi

  echo "⏳ Waiting for app... attempt $i"
  sleep 5
done

echo "❌ Health check failed"
exit 1
