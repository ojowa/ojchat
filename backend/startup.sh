#!/bin/bash
# Startup script for the OJChat backend (single-process monolith).
# Deployed to Azure App Service and run as the startup command.

set -e

echo "Starting OJChat backend (monolith)..."

# Ensure we're in the right directory
cd /home/site/wwwroot/backend

# Check if dist exists
if [ ! -d "dist" ]; then
  echo "ERROR: dist directory not found"
  exit 1
fi

# Run database migrations first
echo "Running database migrations..."
if ! npm run migration:run; then
  echo "ERROR: Database migrations failed; refusing to start with an outdated schema."
  exit 1
fi

# Single process: no child processes, no internal ports (3001-3012).
exec node dist/apps/monolith/src/main.js
