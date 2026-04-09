#!/usr/bin/env python3
"""
Node Monitor - Agent Python
Envoie les métriques système au serveur toutes les 5 secondes.

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
    from tkinter import font as tkfont
    HAS_TK = True
except ImportError:
    HAS_TK = False

DEFAULT_SERVER = "##SERVER_URL##"
AGENT_NAME = socket.gethostname()
INTERVAL_SEC = 5

BG_DARK   = "#0f1117"
BG_CARD   = "#1a1d27"
BG_INPUT  = "#0d1117"
FG_TEXT   = "#e2e8f0"
FG_SUB    = "#6b7280"
FG_BLUE   = "#4f8ef7"
FG_GREEN  = "#34d399"
FG_RED    = "#f87171"
FG_ORANGE = "#fb923c"
BORDER    = "#2d3148"


def get_machine_id():
    """ID stable basé sur hostname + MAC le plus bas parmi toutes les interfaces.
    Utilise psutil si disponible pour lister tous les MACs, sinon uuid.getnode().
    Le résultat est identique même si l'interface réseau active change."""
    try:
        macs = []
        if HAS_PSUTIL:
            for iface, addrs in psutil.net_if_addrs().items():
                for addr in addrs:
                    is_mac = (
                        (hasattr(socket, 'AF_PACKET') and addr.family == socket.AF_PACKET)
                        or addr.family == 18
                    )
                    if is_mac and addr.address:
                        m = addr.address.replace(':', '').replace('-', '').lower()
                        if len(m) == 12 and m not in ('000000000000', 'ffffffffffff'):
                            macs.append(m)
        if not macs:
            m = hex(uuid.getnode())[2:].zfill(12)
            if m not in ('000000000000', 'ffffffffffff'):
                macs = [m]
        stable_mac = sorted(macs)[0] if macs else hex(uuid.getnode())[2:].zfill(12)
        hostname = socket.gethostname()
        raw = f"{hostname}-{stable_mac}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]
    except Exception:
        return hashlib.sha256(socket.gethostname().encode()).hexdigest()[:16]


MACHINE_ID = get_machine_id()


def get_config_path():
    if getattr(sys, 'frozen', False):
        base_dir = os.path.dirname(sys.executable)
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_dir, 'agent_config.json')


def load_config():
    try:
        with open(get_config_path(), 'r') as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(server_url):
    try:
        with open(get_config_path(), 'w') as f:
            json.dump({"server_url": server_url}, f)
    except Exception:
        pass


def get_metrics():
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
                elif addr.family == 18:
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
    data = get_metrics()
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        f"{server_url}/api/agent-report",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.status


# ─────────────────────────────────────────────────────────────
#  GUI APPLICATION
# ─────────────────────────────────────────────────────────────

class AgentApp:
    def __init__(self, cli_server=None):
        self.root = tk.Tk()
        self.root.title("Node Monitor")
        self.root.geometry("420x260")
        self.root.resizable(False, False)
        self.root.configure(bg=BG_DARK)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        try:
            self.root.eval("tk::PlaceWindow . center")
            self.root.attributes("-topmost", True)
            self.root.after(500, lambda: self.root.attributes("-topmost", False))
        except Exception:
            pass

        self.server_url = None
        self.stop_event = threading.Event()
        self.worker = None
        self.send_count = 0
        self.last_ok = None
        self.last_error = None
        self._tick_job = None

        self.frame = tk.Frame(self.root, bg=BG_CARD)
        self.frame.place(relx=0, rely=0, relwidth=1, relheight=1)

        if cli_server:
            self._do_connect(cli_server)
        else:
            self._show_connect_screen()

        self.root.mainloop()

    # ── window close → minimize to taskbar ──────────────────
    def _on_close(self):
        self.root.iconify()

    # ── helpers ─────────────────────────────────────────────
    def _clear(self):
        for w in self.frame.winfo_children():
            w.destroy()
        if self._tick_job:
            self.root.after_cancel(self._tick_job)
            self._tick_job = None

    def _header(self, y=0.10):
        tk.Label(self.frame, text="Node Monitor",
                 font=("Segoe UI", 13, "bold"), fg=FG_TEXT,
                 bg=BG_CARD).place(relx=0.5, rely=y, anchor="center")

    def _btn(self, text, cmd, color=FG_BLUE, y=0.0, width=22):
        b = tk.Button(self.frame, text=text, command=cmd,
                      font=("Segoe UI", 9, "bold"),
                      bg=color, fg="#ffffff",
                      relief="flat", padx=14, pady=6,
                      cursor="hand2",
                      activebackground=color,
                      activeforeground="#ffffff",
                      width=width)
        b.place(relx=0.5, rely=y, anchor="center")
        return b

    def _label(self, text, size=9, color=FG_SUB, y=0.0, bold=False):
        style = "bold" if bold else "normal"
        tk.Label(self.frame, text=text,
                 font=("Segoe UI", size, style),
                 fg=color, bg=BG_CARD,
                 wraplength=360).place(relx=0.5, rely=y, anchor="center")

    def _separator(self, y=0.0):
        sep = tk.Frame(self.frame, bg=BORDER, height=1)
        sep.place(relx=0.05, rely=y, relwidth=0.9)

    # ── SCREEN 1: connection setup ───────────────────────────
    def _show_connect_screen(self):
        self._clear()
        cfg = load_config()
        last = cfg.get("server_url", "")
        injected = DEFAULT_SERVER if "##" not in DEFAULT_SERVER else ""
        saved = last or injected

        self._header(y=0.10)

        if saved:
            # Option A: reconnect to last server
            self._label("Reconnecter au dernier serveur :", size=9, color=FG_SUB, y=0.28)
            self._label(saved, size=9, color=FG_BLUE, y=0.38, bold=True)
            reconnect_btn = self._btn("Se reconnecter", lambda: self._do_connect(saved),
                                      color=FG_GREEN, y=0.52, width=20)

            self._separator(y=0.635)
            self._label("ou entrez une autre adresse :", size=8, color=FG_SUB, y=0.70)

            entry_var = tk.StringVar(value="")
            entry = tk.Entry(self.frame, textvariable=entry_var, width=32,
                             font=("Consolas", 9),
                             bg=BG_INPUT, fg=FG_TEXT,
                             insertbackground=FG_TEXT,
                             relief="flat", bd=6)
            entry.place(relx=0.5, rely=0.82, anchor="center")
            entry.bind('<Return>', lambda e: self._connect_from_entry(entry_var))

            def connect_other():
                val = entry_var.get().strip()
                if val:
                    self._connect_from_entry(entry_var)
                else:
                    entry.focus_set()

            self._btn("Autre serveur", connect_other, color=FG_BLUE, y=0.93, width=14)

        else:
            # No saved config — just URL input
            self._label("Entrez l'adresse du serveur :", size=9, color=FG_SUB, y=0.35)
            entry_var = tk.StringVar(value="")
            entry = tk.Entry(self.frame, textvariable=entry_var, width=36,
                             font=("Consolas", 9),
                             bg=BG_INPUT, fg=FG_TEXT,
                             insertbackground=FG_TEXT,
                             relief="flat", bd=6)
            entry.place(relx=0.5, rely=0.52, anchor="center")
            entry.focus_set()
            entry.bind('<Return>', lambda e: self._connect_from_entry(entry_var))
            self._btn("Connecter", lambda: self._connect_from_entry(entry_var),
                      color=FG_BLUE, y=0.72, width=18)

    def _connect_from_entry(self, entry_var):
        val = entry_var.get().strip().rstrip('/')
        if not val:
            return
        if not val.startswith('http'):
            val = 'http://' + val
        self._do_connect(val)

    # ── SCREEN 2: connecting (brief) ─────────────────────────
    def _show_connecting_screen(self, url):
        self._clear()
        self._header(y=0.20)
        self._label("Connexion en cours…", size=9, color=FG_SUB, y=0.42)
        self._label(url, size=8, color=FG_BLUE, y=0.55)

    # ── SCREEN 3: running ────────────────────────────────────
    def _show_running_screen(self):
        self._clear()
        self.root.geometry("420x260")

        tk.Label(self.frame, text="✓", font=("Segoe UI", 26, "bold"),
                 fg=FG_GREEN, bg=BG_CARD).place(relx=0.13, rely=0.22, anchor="center")

        self._header(y=0.10)
        self._label("Connecté · envoi en cours", size=9, color=FG_GREEN, y=0.22)
        self._separator(y=0.33)

        self._label(f"Serveur : {self.server_url}", size=8, color=FG_BLUE, y=0.43)
        self._label(f"Machine : {AGENT_NAME}  ·  ID {MACHINE_ID}", size=8, color=FG_SUB, y=0.54)

        self._status_lbl = tk.Label(self.frame, text="",
                                    font=("Segoe UI", 8),
                                    fg=FG_SUB, bg=BG_CARD)
        self._status_lbl.place(relx=0.5, rely=0.65, anchor="center")

        self._btn("Arrêter la connexion", self._do_stop,
                  color=FG_RED, y=0.82, width=22)

        self._tick()

    def _tick(self):
        if self._status_lbl.winfo_exists():
            if self.last_error:
                self._status_lbl.config(
                    text=f"Dernière erreur : {self.last_error[:48]}",
                    fg=FG_ORANGE)
            elif self.last_ok:
                elapsed = int(time.time() - self.last_ok)
                self._status_lbl.config(
                    text=f"Dernier envoi : il y a {elapsed}s  ·  Total : {self.send_count}",
                    fg=FG_SUB)
        self._tick_job = self.root.after(1000, self._tick)

    # ── SCREEN 4: stopped ────────────────────────────────────
    def _show_stopped_screen(self):
        self._clear()
        self.root.geometry("420x260")

        tk.Label(self.frame, text="●", font=("Segoe UI", 22, "bold"),
                 fg=FG_SUB, bg=BG_CARD).place(relx=0.13, rely=0.22, anchor="center")

        self._header(y=0.10)
        self._label("Connexion arrêtée", size=9, color=FG_ORANGE, y=0.22)
        self._separator(y=0.33)
        self._label(f"Serveur : {self.server_url}", size=8, color=FG_SUB, y=0.43)

        # Two action buttons side by side
        btn_frame = tk.Frame(self.frame, bg=BG_CARD)
        btn_frame.place(relx=0.5, rely=0.65, anchor="center")

        tk.Button(btn_frame, text="Relancer",
                  command=self._do_restart,
                  font=("Segoe UI", 9, "bold"),
                  bg=FG_GREEN, fg="#ffffff",
                  relief="flat", padx=16, pady=6,
                  cursor="hand2",
                  activebackground=FG_GREEN,
                  activeforeground="#ffffff").pack(side="left", padx=6)

        tk.Button(btn_frame, text="Changer de serveur",
                  command=self._show_connect_screen,
                  font=("Segoe UI", 9, "bold"),
                  bg=FG_BLUE, fg="#ffffff",
                  relief="flat", padx=16, pady=6,
                  cursor="hand2",
                  activebackground=FG_BLUE,
                  activeforeground="#ffffff").pack(side="left", padx=6)

        self._btn("Quitter", self._quit, color="#374151", y=0.88, width=14)

    # ── ACTIONS ─────────────────────────────────────────────
    def _do_connect(self, url):
        self.server_url = url
        save_config(url)
        self._show_connecting_screen(url)

        def attempt():
            try:
                status = post_metrics(url)
                ok = status == 200
                err = "" if ok else f"HTTP {status}"
            except Exception as exc:
                ok = False
                err = str(exc)
            self.root.after(0, lambda: self._after_connect(url, ok, err))

        threading.Thread(target=attempt, daemon=True).start()

    def _after_connect(self, url, ok, err):
        if ok:
            self.last_ok = time.time()
            self.last_error = None
            self.send_count = 1
            self._start_worker(url)
            self._show_running_screen()
        else:
            self._show_error_screen(url, err)

    def _show_error_screen(self, url, err):
        self._clear()
        self.root.geometry("420x260")

        tk.Label(self.frame, text="✕", font=("Segoe UI", 26, "bold"),
                 fg=FG_RED, bg=BG_CARD).place(relx=0.13, rely=0.22, anchor="center")

        self._header(y=0.10)
        self._label("Impossible de joindre le serveur", size=9, color=FG_RED, y=0.22)
        self._separator(y=0.33)
        self._label(url, size=8, color=FG_SUB, y=0.42)
        self._label(err[:60] if err else "Vérifiez l'URL et votre connexion",
                    size=8, color=FG_ORANGE, y=0.54)

        btn_frame = tk.Frame(self.frame, bg=BG_CARD)
        btn_frame.place(relx=0.5, rely=0.73, anchor="center")

        tk.Button(btn_frame, text="Réessayer",
                  command=lambda: self._do_connect(url),
                  font=("Segoe UI", 9, "bold"),
                  bg=FG_GREEN, fg="#ffffff",
                  relief="flat", padx=16, pady=6,
                  cursor="hand2",
                  activebackground=FG_GREEN,
                  activeforeground="#ffffff").pack(side="left", padx=6)

        tk.Button(btn_frame, text="Changer de serveur",
                  command=self._show_connect_screen,
                  font=("Segoe UI", 9, "bold"),
                  bg=FG_BLUE, fg="#ffffff",
                  relief="flat", padx=16, pady=6,
                  cursor="hand2",
                  activebackground=FG_BLUE,
                  activeforeground="#ffffff").pack(side="left", padx=6)

    def _start_worker(self, url):
        self.stop_event.clear()

        def loop():
            while not self.stop_event.is_set():
                try:
                    status = post_metrics(url)
                    self.last_ok = time.time()
                    self.last_error = None
                    self.send_count += 1
                    print(f"[{time.strftime('%H:%M:%S')}] OK → {url} ({status})")
                except Exception as exc:
                    self.last_error = str(exc)
                    print(f"[{time.strftime('%H:%M:%S')}] Erreur: {exc}")
                self.stop_event.wait(INTERVAL_SEC)

        self.worker = threading.Thread(target=loop, daemon=True)
        self.worker.start()

    def _do_stop(self):
        self.stop_event.set()
        self._show_stopped_screen()

    def _do_restart(self):
        self._do_connect(self.server_url)

    def _quit(self):
        self.stop_event.set()
        self.root.destroy()
        sys.exit(0)


# ─────────────────────────────────────────────────────────────
#  CONSOLE MODE (no tkinter)
# ─────────────────────────────────────────────────────────────

def run_console(cli_server=None):
    global AGENT_NAME, INTERVAL_SEC

    cfg = load_config()
    injected = DEFAULT_SERVER if '##' not in DEFAULT_SERVER else ""
    saved = cfg.get("server_url", "")

    if cli_server:
        server_url = cli_server
    elif saved:
        print(f"Dernier serveur : {saved}")
        ans = input("Appuyez sur Entrée pour reconnecter, ou entrez un autre serveur : ").strip()
        server_url = ans.rstrip('/') if ans else saved
    elif injected:
        server_url = injected
    else:
        server_url = input("Adresse du serveur : ").strip().rstrip('/')

    if not server_url:
        print("Aucune URL. Arrêt.")
        sys.exit(1)
    if not server_url.startswith('http'):
        server_url = 'http://' + server_url

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

    stop_event = threading.Event()

    def loop():
        while not stop_event.is_set():
            try:
                status = post_metrics(server_url)
                print(f"[{time.strftime('%H:%M:%S')}] OK → {server_url} ({status})")
            except Exception as exc:
                print(f"[{time.strftime('%H:%M:%S')}] Erreur: {exc}")
            stop_event.wait(INTERVAL_SEC)

    worker = threading.Thread(target=loop, daemon=True)
    worker.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        stop_event.set()
        print("\nAgent arrêté.")


# ─────────────────────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────────────────────

def main():
    global AGENT_NAME, INTERVAL_SEC

    parser = argparse.ArgumentParser(description="Node Monitor Agent")
    parser.add_argument("--server", default="", help="URL du serveur")
    parser.add_argument("--name", default=socket.gethostname())
    parser.add_argument("--interval", type=int, default=5)
    parser.add_argument("--no-gui", action="store_true", help="Mode console uniquement")
    args = parser.parse_args()

    AGENT_NAME = args.name
    INTERVAL_SEC = args.interval

    cli_server = args.server.rstrip('/') if args.server else None
    if cli_server and not cli_server.startswith('http'):
        cli_server = 'http://' + cli_server

    if HAS_TK and not args.no_gui:
        AgentApp(cli_server=cli_server)
    else:
        run_console(cli_server=cli_server)


if __name__ == "__main__":
    main()
