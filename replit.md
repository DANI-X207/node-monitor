# Remote PC Monitoring System

A real-time system monitoring dashboard that tracks CPU, RAM, Disk, and GPU metrics from multiple client machines.

## Architecture

### Backend (Node.js/Express)
- **`backend/server.js`** - Main Express server, Socket.io setup, port 5000
- **`backend/config.js`** - Server configuration (port, DB path, socket settings)
- **`backend/database.js`** - SQLite database layer using `better-sqlite3`
- **`backend/routes/api.js`** - REST API endpoints for machines and metrics
- **`backend/middleware/socketHandler.js`** - Real-time Socket.io event handlers
- **`backend/views/`** - EJS-rendered HTML templates (index.html, download.html)
- **`backend/public/`** - Static assets (CSS, client-side JS)

### Agent (Python)
- **`agent/agent.py`** - Main agent entry point with Socket.io client
- **`agent/system_info.py`** - System metrics collection using psutil
- **`agent/config_agent.py`** - Agent configuration (server URL, intervals)
- **`agent/build_agent.py`** - PyInstaller build script for standalone executables
- **`agent/requirements.txt`** - Python dependencies

## Tech Stack
- **Server**: Node.js, Express, Socket.io, better-sqlite3, EJS
- **Dashboard**: Vanilla JS, Chart.js, Socket.io client
- **Agent**: Python 3, psutil, python-socketio, PyInstaller
- **Database**: SQLite (stored at `backend/data/monitoring.db`)

## Running the App

The server runs via the "Start application" workflow:
```
cd backend && node server.js
```
Server listens on port 5000.

## Key Features
- Real-time metrics (CPU, RAM, Disk) via WebSockets
- 24-hour historical charts per machine
- Auto-reconnecting agents
- Machine online/offline status tracking
- Metrics cleanup (data older than 24h purged hourly)

## Agent Setup
Agents connect to the server URL configured in `agent/config_agent.py` (default: `http://localhost:5000`). Install Python deps: `pip install -r agent/requirements.txt`, then run `python agent.py`.
