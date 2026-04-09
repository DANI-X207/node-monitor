#!/usr/bin/env python3
"""
Node Monitor - Agent Python
Envoie les métriques système au serveur toutes les 60 secondes.

Usage:
    python agent.py
    python agent.py --server http://VOTRE_SERVEUR:5000

Dépendance recommandée (métriques complètes) :
    pip install psutil

Créer un .exe Windows (sans console) :
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
    from tkinter import messagebox
    HAS_TK = True
except ImportError:
    HAS_TK = False

DEFAULT_SERVER = "##SERVER_URL##"
AGENT_NAME = socket.gethostname()
INTERVAL_SEC = 5


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


def get_config_path():
    """Chemin du fichier de configuration, à côté de l'exécutable."""
    if getattr(sys, 'frozen', False):
        base_dir = os.path.dirname(sys.executable)
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_dir, 'agent_config.json')


def load_config():
    """Charge la configuration sauvegardée."""
    try:
        with open(get_config_path(), 'r') as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(server_url):
    """Sauvegarde l'URL du serveur."""
    try:
        with open(get_config_path(), 'w') as f:
            json.dump({"server_url": server_url}, f)
    except Exception:
        pass


def ask_server_url_gui(default_url=""):
    """Affiche une boîte de dialogue pour saisir l'URL du serveur."""
    if not HAS_TK:
        return None

    result = {"url": None}

    root = tk.Tk()
    root.title("Node Monitor — Configuration")
    root.geometry("420x200")
    root.resizable(False, False)
    root.configure(bg="#0f1117")

    try:
        root.eval("tk::PlaceWindow . center")
    except Exception:
        pass

    try:
        root.attributes("-topmost", True)
    except Exception:
        pass

    frame = tk.Frame(root, bg="#1a1d27", bd=0)
    frame.place(relx=0, rely=0, relwidth=1, relheight=1)

    tk.Label(frame, text="Node Monitor",
             font=("Segoe UI", 13, "bold"), fg="#e2e8f0",
             bg="#1a1d27").place(relx=0.5, rely=0.13, anchor="center")

    tk.Label(frame, text="Entrez l'adresse du serveur :",
             font=("Segoe UI", 9), fg="#6b7280",
             bg="#1a1d27").place(relx=0.5, rely=0.3, anchor="center")

    entry_var = tk.StringVar(value=default_url)
    entry = tk.Entry(frame, textvariable=entry_var, width=38,
                     font=("Consolas", 9),
                     bg="#0d1117", fg="#e2e8f0",
                     insertbackground="#e2e8f0",
                     relief="flat", bd=6)
    entry.place(relx=0.5, rely=0.52, anchor="center")
    entry.focus_set()

    def on_connect():
        url = entry_var.get().strip().rstrip('/')
        if not url:
            return
        if not url.startswith('http'):
            url = 'http://' + url
        result["url"] = url
        root.destroy()

    entry.bind('<Return>', lambda e: on_connect())

    btn = tk.Button(frame, text="Connecter", command=on_connect,
                    font=("Segoe UI", 9, "bold"),
                    bg="#4f8ef7", fg="#ffffff",
                    relief="flat", padx=16, pady=5,
                    cursor="hand2", activebackground="#3b7de8",
                    activeforeground="#ffffff")
    btn.place(relx=0.5, rely=0.78, anchor="center")

    root.mainloop()
    return result["url"]


def ask_server_url_console(default_url=""):
    """Demande l'URL du serveur en mode console."""
    prompt = f"Adresse du serveur [{default_url}]: " if default_url else "Adresse du serveur: "
    try:
        val = input(prompt).strip().rstrip('/')
    except EOFError:
        val = ""
    if not val:
        return default_url
    if not val.startswith('http'):
        val = 'http://' + val
    return val


def show_status_window(success, server_url, error_msg=""):
    """Affiche une fenêtre de statut de connexion."""
    if not HAS_TK:
        return

    root = tk.Tk()
    root.title("Node Monitor")
    root.geometry("380x140")
    root.resizable(False, False)
    root.configure(bg="#0f1117")

    try:
        root.eval("tk::PlaceWindow . center")
        root.attributes("-topmost", True)
    except Exception:
        pass

    frame = tk.Frame(root, bg="#1a1d27", bd=0)
    frame.place(relx=0, rely=0, relwidth=1, relheight=1)

    if success:
        icon_text, icon_color = "✓", "#34d399"
        title_text = "Serveur connecté"
        sub_text = f"Nom : {AGENT_NAME}"
    else:
        icon_text, icon_color = "✕", "#f87171"
        title_text = "Impossible de joindre le serveur"
        sub_text = (error_msg[:50] if error_msg else "Vérifiez l'URL et votre connexion")

    tk.Label(frame, text=icon_text, font=("Segoe UI", 28, "bold"),
             fg=icon_color, bg="#1a1d27").place(relx=0.11, rely=0.5, anchor="center")

    tk.Label(frame, text=title_text,
             font=("Segoe UI", 11, "bold"),
             fg="#e2e8f0", bg="#1a1d27").place(relx=0.58, rely=0.3, anchor="center")

    tk.Label(frame, text=sub_text, font=("Segoe UI", 9),
             fg="#6b7280", bg="#1a1d27").place(relx=0.58, rely=0.52, anchor="center")

    tk.Label(frame, text=f"ID : {MACHINE_ID}",
             font=("Consolas", 8), fg="#4f8ef7",
             bg="#1a1d27").place(relx=0.58, rely=0.74, anchor="center")

    root.after(4000, root.destroy)
    root.mainloop()


def get_metrics(server_url):
    ips = []
    interfaces = []

    if HAS_PSUTIL:
        for iface, addrs in psutil.net_if_addrs().items():
            iface_entry = {"name": iface, "ipv4": None, "netmask": None, "ipv6": [], "mac": None}
            for addr in addrs:
                if addr.family == socket.AF_INET:
                    iface_entry["ipv4"] = addr.address
                    iface_entry["netmask"] = addr.netmask
                    if not addr.address.startswith("127."):
                        ips.append(f"{iface}:{addr.address}")
                elif addr.family == socket.AF_INET6:
                    ip6 = addr.address.split("%")[0]
                    iface_entry["ipv6"].append(ip6)
                elif hasattr(socket, "AF_PACKET") and addr.family == socket.AF_PACKET:
                    iface_entry["mac"] = addr.address
                elif hasattr(psutil, "_pslinux") is False and addr.family == 18:
                    iface_entry["mac"] = addr.address
            if iface_entry["ipv4"] or iface_entry["ipv6"]:
                interfaces.append(iface_entry)

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
        mem_total, mem_used, mem_free = mem.total, mem.used, mem.available
        mem_pct = round(mem.percent, 1)
        net_rx, net_tx = net.bytes_recv, net.bytes_sent
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
        "interfaces": interfaces,
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


def post_metrics(server_url):
    data = get_metrics(server_url)
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        f"{server_url}/api/agent-report",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.status


def send_loop(server_url):
    while True:
        try:
            status = post_metrics(server_url)
            print(f"[{time.strftime('%H:%M:%S')}] OK → {server_url} ({status})")
        except Exception as exc:
            print(f"[{time.strftime('%H:%M:%S')}] Erreur: {exc}")
        time.sleep(INTERVAL_SEC)


def main():
    global AGENT_NAME, INTERVAL_SEC

    parser = argparse.ArgumentParser(description="Node Monitor Agent")
    parser.add_argument("--server", default="", help="URL du serveur (ex: http://monserveur:5000)")
    parser.add_argument("--name", default=socket.gethostname())
    parser.add_argument("--interval", type=int, default=60)
    args = parser.parse_args()

    AGENT_NAME = args.name
    INTERVAL_SEC = args.interval

    cfg = load_config()
    injected = DEFAULT_SERVER if '##' not in DEFAULT_SERVER else ""

    if args.server:
        server_url = args.server.rstrip('/')
    elif cfg.get("server_url"):
        server_url = cfg["server_url"]
    elif HAS_TK:
        server_url = ask_server_url_gui(default_url=injected)
        if not server_url:
            sys.exit(0)
    else:
        server_url = ask_server_url_console(default_url=injected)
        if not server_url:
            print("Aucune URL saisie. Arrêt.")
            sys.exit(1)

    save_config(server_url)

    print("=" * 52)
    print("  Node Monitor Agent")
    print("=" * 52)
    print(f"  Serveur    : {server_url}")
    print(f"  Nom        : {AGENT_NAME}")
    print(f"  ID Machine : {MACHINE_ID}")
    print(f"  Intervalle : {INTERVAL_SEC}s")
    print(f"  psutil     : {'OK' if HAS_PSUTIL else 'MANQUANT — pip install psutil'}")
    print("=" * 52)

    connected = False
    error_msg = ""
    try:
        status = post_metrics(server_url)
        connected = (status == 200)
        print(f"  Connexion  : OK ({status})")
    except Exception as exc:
        error_msg = str(exc)
        print(f"  Connexion  : ECHEC — {exc}")

    if HAS_TK:
        win_thread = threading.Thread(
            target=show_status_window,
            args=(connected, server_url, error_msg),
            daemon=True
        )
        win_thread.start()
        win_thread.join()

    worker = threading.Thread(target=send_loop, args=(server_url,), daemon=True)
    worker.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nAgent arrêté.")


if __name__ == "__main__":
    main()
