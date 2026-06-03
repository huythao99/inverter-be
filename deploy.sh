#!/bin/bash

APP_DIR="/var/www/inverter-be"
SERVICE_NAME="nestjs"

cd $APP_DIR

echo "Starting deployment..."

# Pull latest changes
git pull origin main

# Install/update dependencies
npm ci --only=production

# Build application
npm run build

# Restart the service
sudo systemctl restart $SERVICE_NAME

echo "Deployment completed!"

# Optional: Send notification
# curl -X POST "https://api.slack.com/api/chat.postMessage" \
#      -H "Authorization: Bearer YOUR_SLACK_TOKEN" \
#      -H "Content-type: application/json" \
#      --data '{"channel":"#deployments","text":"✅ App deployed successfully"}'
