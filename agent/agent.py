#!/usr/bin/env python3
"""
Node Monitor - Agent Python
Envoie les métriques système au serveur toutes les 60 secondes.

Usage:
    python agent.py --server http://VOTRE_SERVEUR:5000 --name MON_PC

Dépendance recommandée (métriques complètes) :
    pip install psutil

Créer un .exe Windows (pas de console) :
    pip install pyinstaller psutil
    pyinstaller --onefile --noconsole --name node-monitor-agent agent.py

Créer un binaire Linux / macOS :
    pip install pyinstaller psutil
    pyinstaller --onefile --name node-monitor-agent agent.py
"""

import sys
import os
import time
import json
import uuid
import socket
import hashlib
import platform
import threading
import argparse
import urllib.request
import urllib.error

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

try:
    import tkinter as tk
    HAS_TK = True
except ImportError:
    HAS_TK = False

SERVER_URL = "##SERVER_URL##"
AGENT_NAME = socket.gethostname()
INTERVAL_SEC = 60


def get_machine_id():
    """ID stable basé sur hostname + adresse MAC (ne change pas si réseau change)."""
    try:
        mac = hex(uuid.getnode())[2:].zfill(12)
        hostname = socket.gethostname()
        raw = f"{hostname}-{mac}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]
    except Exception:
        return hashlib.sha256(socket.gethostname().encode()).hexdigest()[:16]


MACHINE_ID = get_machine_id()


def show_startup_window(success, error_msg=""):
    if not HAS_TK:
        return

    root = tk.Tk()
    root.title("Node Monitor")
    root.geometry("360x130")
    root.resizable(False, False)
    root.configure(bg="#0f1117")

    try:
        root.eval("tk::PlaceWindow . center")
    except Exception:
        pass

    frame = tk.Frame(root, bg="#1a1d27", bd=0)
    frame.place(relx=0, rely=0, relwidth=1, relheight=1)

    if success:
        icon_text = "✓"
        icon_color = "#34d399"
        title_text = "Serveur connecté"
        sub_text = f"Nom : {AGENT_NAME}"
    else:
        icon_text = "✕"
        icon_color = "#f87171"
        title_text = "Impossible de joindre le serveur"
        sub_text = error_msg[:48] if error_msg else "Vérifiez l'URL et votre connexion"

    tk.Label(frame, text=icon_text, font=("Segoe UI", 28, "bold"),
             fg=icon_color, bg="#1a1d27").place(relx=0.12, rely=0.5, anchor="center")

    tk.Label(frame, text=title_text,
             font=("Segoe UI", 12, "bold"),
             fg="#e2e8f0", bg="#1a1d27").place(relx=0.57, rely=0.35, anchor="center")

    tk.Label(frame, text=sub_text,
             font=("Segoe UI", 9), fg="#6b7280",
             bg="#1a1d27").place(relx=0.57, rely=0.58, anchor="center")

    tk.Label(frame, text=f"ID  : {MACHINE_ID}",
             font=("Consolas", 8), fg="#4f8ef7",
             bg="#1a1d27").place(relx=0.57, rely=0.76, anchor="center")

    root.after(4000, root.destroy)

    try:
        root.attributes("-topmost", True)
    except Exception:
        pass

    root.mainloop()


def get_metrics():
    ips = []
    for iface, addrs in (psutil.net_if_addrs() if HAS_PSUTIL else {}).items():
        for addr in addrs:
            if addr.family == socket.AF_INET and not addr.address.startswith("127."):
                ips.append(f"{iface}:{addr.address}")

    if not ips:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ips = [s.getsockname()[0]]
            s.close()
        except Exception:
            ips = []

    if HAS_PSUTIL:
        cpu_pct = psutil.cpu_percent(interval=0.5)
        mem = psutil.virtual_memory()
        net = psutil.net_io_counters()
        uptime = time.time() - psutil.boot_time()
        cpu_cores = psutil.cpu_count(logical=True)
        cpu_physical = psutil.cpu_count(logical=False) or cpu_cores
        disk_list = []
        for part in psutil.disk_partitions():
            try:
                usage = psutil.disk_usage(part.mountpoint)
                disk_list.append({
                    "mount": part.mountpoint,
                    "total": usage.total,
                    "used": usage.used,
                    "free": usage.free,
                    "percent": usage.percent
                })
            except Exception:
                pass
        mem_total = mem.total
        mem_used = mem.used
        mem_free = mem.available
        mem_pct = round(mem.percent, 1)
        net_rx = net.bytes_recv
        net_tx = net.bytes_sent
    else:
        cpu_pct = 0.0
        cpu_cores = os.cpu_count() or 1
        cpu_physical = cpu_cores
        uptime = 0
        mem_total = mem_used = mem_free = 0
        mem_pct = 0.0
        net_rx = net_tx = 0
        disk_list = []

    return {
        "agentId": MACHINE_ID,
        "name": AGENT_NAME,
        "timestamp": int(time.time() * 1000),
        "hostname": socket.gethostname(),
        "platform": sys.platform,
        "os": platform.system() + " " + platform.release(),
        "arch": platform.machine(),
        "ips": ips,
        "uptime": uptime,
        "cpu": {
            "model": platform.processor() or platform.uname().processor or "Unknown",
            "cores": cpu_cores,
            "physicalCores": cpu_physical,
            "loadPercent": str(round(cpu_pct, 1)),
        },
        "memory": {
            "total": mem_total,
            "used": mem_used,
            "free": mem_free,
            "usedPercent": str(mem_pct),
        },
        "network": {"rx": net_rx, "tx": net_tx},
        "disk": disk_list,
    }


def post_metrics():
    data = get_metrics()
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        f"{SERVER_URL}/api/agent-report",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.status


def send_loop():
    while True:
        try:
            status = post_metrics()
            print(f"[{time.strftime('%H:%M:%S')}] OK → {SERVER_URL} ({status})")
        except Exception as exc:
            print(f"[{time.strftime('%H:%M:%S')}] Erreur: {exc}")
        time.sleep(INTERVAL_SEC)


def main():
    global SERVER_URL, AGENT_NAME, INTERVAL_SEC

    parser = argparse.ArgumentParser(description="Node Monitor Agent")
    parser.add_argument("--server", default=SERVER_URL)
    parser.add_argument("--name", default=socket.gethostname())
    parser.add_argument("--interval", type=int, default=60)
    args = parser.parse_args()

    SERVER_URL = args.server
    AGENT_NAME = args.name
    INTERVAL_SEC = args.interval

    print("=" * 52)
    print("  Node Monitor Agent")
    print("=" * 52)
    print(f"  Serveur    : {SERVER_URL}")
    print(f"  Nom        : {AGENT_NAME}")
    print(f"  ID Machine : {MACHINE_ID}")
    print(f"  Intervalle : {INTERVAL_SEC}s")
    print(f"  psutil     : {'OK' if HAS_PSUTIL else 'MANQUANT — pip install psutil'}")
    print("=" * 52)

    connected = False
    error_msg = ""
    try:
        status = post_metrics()
        connected = (status == 200)
        print(f"  Connexion  : OK ({status})")
    except Exception as exc:
        error_msg = str(exc)
        print(f"  Connexion  : ECHEC — {exc}")

    if HAS_TK:
        win_thread = threading.Thread(
            target=show_startup_window, args=(connected, error_msg), daemon=True
        )
        win_thread.start()
        win_thread.join()

    worker = threading.Thread(target=send_loop, daemon=True)
    worker.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nAgent arrêté.")


if __name__ == "__main__":
    main()
