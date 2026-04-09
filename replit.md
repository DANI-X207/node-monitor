# Node Monitor — Remote PC Monitoring System

A real-time system monitoring dashboard with dark UI that tracks CPU, RAM, Disk, Network and Uptime from multiple client machines.

## Architecture

### Backend (Node.js/Express)
- **`backend/server.js`** - Main Express server, Socket.io setup, port 5000
- **`backend/config.js`** - Server configuration (port, DB path, socket settings)
- **`backend/database.js`** - SQLite database layer using `better-sqlite3`
- **`backend/routes/api.js`** - REST API: machines list, machine detail, history, visitor IP, agent.py download
- **`backend/middleware/socketHandler.js`** - Real-time Socket.io event handlers
- **`backend/views/index.html`** - Single-page app with Vue Globale + Ma Machine views
- **`backend/public/css/style.css`** - Dark theme UI
- **`backend/public/js/script.js`** - Dashboard logic (socket, rendering, view switching)

### Agent (Python)
- **`agent/agent.py`** - Main agent with Socket.io client, sends metrics every 5s
- **`agent/system_info.py`** - System metrics: CPU model/cores/%, RAM, Disks, Network, Uptime, MAC address
- **`agent/config_agent.py`** - Agent config (SERVER_URL, intervals)
- **`agent/build_agent.py`** - PyInstaller build script
- **`agent/requirements.txt`** - Python dependencies

## Tech Stack
- **Server**: Node.js, Express, Socket.io, better-sqlite3, EJS
- **Dashboard**: Vanilla JS, Socket.io client (no framework)
- **Styling**: Pure CSS dark theme
- **Agent**: Python 3, psutil, python-socketio
- **Database**: SQLite at `backend/data/monitoring.db`

## Running the App

The "Start application" workflow runs:
```
cd backend && node server.js
```
Server listens on **port 5000**.

## UI Features

### Vue Globale
- All connected machines as cards
- Shows: hostname, OS, CPU%, RAM%, RAM used, uptime, last seen
- **IP addresses are hidden** from global view

### Ma Machine
- Auto-detected via IP matching between visitor and agent
- Machine ID stored in localStorage for persistence
- Shows: CPU (model, %, gauge), RAM (used/total/free, gauge), Disks (per-disk bars), Network (sent/recv)
- Shows "no agent" state if no matching agent found

### Télécharger l'agent (dropdown)
- **Windows (.exe)**: Direct download of pre-built `node-monitor-agent.exe` via `/api/download/windows`, with usage notice modal based on agent.py GUI behaviour
- **Linux (installateur)**: Download of `install-linux.sh` via `/api/download/linux` (server URL injected), with usage notice modal; script installs psutil, downloads agent.py, and optionally sets up a systemd service
- **agent.py (tous systèmes)**: Direct download with server URL injected from `/api/download/agent`
- **macOS**: Compilation guide modal (PyInstaller)

## Machine Identification
- Each agent is identified by a SHA-256 hash of `hostname + lowest MAC address`, truncated to 16 chars
- Database uses `ON CONFLICT(machine_id) DO UPDATE` to upsert on each report
- **Deduplication**: `deduplicateByHostname()` is called on every agent report to remove stale records with the same hostname but a different machine_id (prevents duplicate cards)
- Browser auto-detects "Ma Machine" by comparing visitor IP with agent source IPs
- Network interfaces are preserved across `fetchMachines()` polling calls to prevent flickering

## Agent Setup
1. Download `agent.py` from the dashboard
2. `pip install -r requirements.txt`
3. Set `SERVER_URL` in `config_agent.py`
4. `python agent.py`
