#!/bin/bash
set -e
echo "=== Optimum Q Deploy ==="
cd /opt/optimumq
git pull origin main
echo "--- Rebuilding frontend ---"
cd frontend
export NODE_OPTIONS=--openssl-legacy-provider
CI=false npm run build 2>&1 | tail -3
cd /opt/optimumq
echo "--- Restarting backend ---"
pm2 restart optimumq-api
systemctl reload nginx
echo "=== Deploy complete ==="
