#!/bin/bash
# Beast Dashboard static + Notion-sync API server on localhost:4880.
# launchd: com.beast-dashboard.server.plist

set -u
cd /Users/beanhq/beast-dashboard
mkdir -p logs data

exec /usr/bin/python3 /Users/beanhq/beast-dashboard/server.py
