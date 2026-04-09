#!/usr/bin/env python3
"""
L2-IG2 Monitor - Agent Python
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

# ── Dark theme colours ───────────────────────────────────────
BG_DARK   = "#0d1117"
BG_CARD   = "#161b22"
BG_INPUT  = "#0d1117"
FG_TEXT   = "#e2e8f0"
FG_SUB    = "#6b7280"
FG_BLUE   = "#4f8ef7"
FG_GREEN  = "#34d399"
FG_RED    = "#f87171"
FG_ORANGE = "#fb923c"
BORDER    = "#2d3148"


def get_machine_id():
    """ID stable basé sur hostname + MAC le plus bas parmi toutes les interfaces."""
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


def send_disconnect(server_url):
    """Notifie le serveur que cet agent passe hors ligne."""
    try:
        body = json.dumps({"agentId": MACHINE_ID}).encode("utf-8")
        req = urllib.request.Request(
            f"{server_url}/api/agent-disconnect",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────
#  GUI APPLICATION  —  L2-IG2 Monitor Agent
# ─────────────────────────────────────────────────────────────

class AgentApp:
    APP_TITLE = "L2-IG2 Monitor"
    WIN_W, WIN_H = 480, 340
    MIN_W, MIN_H = 400, 280

    def __init__(self, cli_server=None):
        self.root = tk.Tk()
        self.root.title(self.APP_TITLE)
        self.root.minsize(self.MIN_W, self.MIN_H)
        self.root.resizable(True, True)
        self.root.configure(bg=BG_DARK)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        # State
        self.server_url = None
        self.stop_event = threading.Event()
        self.worker = None
        self.send_count = 0
        self.last_ok = None
        self.last_error = None
        self._tick_job = None
        self._resize_cb = None
        self._run_status_lbl = None

        # ── Root grid: header (0), separator (1), body (2) ──
        self.root.rowconfigure(2, weight=1)
        self.root.columnconfigure(0, weight=1)

        self._build_header()
        tk.Frame(self.root, bg=BORDER, height=1).grid(row=1, column=0, sticky="ew")

        self._body = tk.Frame(self.root, bg=BG_CARD)
        self._body.grid(row=2, column=0, sticky="nsew")

        # Center window on screen
        try:
            self.root.update_idletasks()
            sw = self.root.winfo_screenwidth()
            sh = self.root.winfo_screenheight()
            x = (sw - self.WIN_W) // 2
            y = (sh - self.WIN_H) // 2
            self.root.geometry(f"{self.WIN_W}x{self.WIN_H}+{x}+{y}")
            self.root.attributes("-topmost", True)
            self.root.after(500, lambda: self.root.attributes("-topmost", False))
        except Exception:
            self.root.geometry(f"{self.WIN_W}x{self.WIN_H}")

        if cli_server:
            self._do_connect(cli_server)
        else:
            self._show_connect_screen()

        self.root.mainloop()

    # ── Header ───────────────────────────────────────────────

    def _build_header(self):
        hdr = tk.Frame(self.root, bg=BG_DARK)
        hdr.grid(row=0, column=0, sticky="ew")
        hdr.columnconfigure(1, weight=1)

        # Dot + name
        tk.Label(hdr, text="●", font=("Segoe UI", 10, "bold"),
                 fg=FG_BLUE, bg=BG_DARK).grid(row=0, column=0, padx=(16, 6), pady=11)
        tk.Label(hdr, text=self.APP_TITLE, font=("Segoe UI", 12, "bold"),
                 fg=FG_TEXT, bg=BG_DARK).grid(row=0, column=1, sticky="w", pady=11)

        # Status badge (right)
        self._hdr_status = tk.Label(hdr, text="Non connecté",
                                     font=("Segoe UI", 8),
                                     fg=FG_SUB, bg=BG_DARK)
        self._hdr_status.grid(row=0, column=2, padx=(0, 16), pady=11)

    def _set_status(self, text, color=FG_SUB):
        self._hdr_status.config(text=text, fg=color)

    # ── Body helpers ─────────────────────────────────────────

    def _clear(self):
        for w in self._body.winfo_children():
            w.destroy()
        if self._tick_job:
            self.root.after_cancel(self._tick_job)
            self._tick_job = None
        if self._resize_cb is not None:
            try:
                self._body.unbind("<Configure>", self._resize_cb)
            except Exception:
                pass
            self._resize_cb = None
        self._run_status_lbl = None

    def _centered(self):
        """Return a frame centered in self._body; stays centered on resize."""
        f = tk.Frame(self._body, bg=BG_CARD)
        f.place(relx=0.5, rely=0.5, anchor="center")
        self._resize_cb = self._body.bind(
            "<Configure>",
            lambda _e: f.place_configure(relx=0.5, rely=0.5, anchor="center")
        )
        return f

    def _sep(self, parent):
        tk.Frame(parent, bg=BORDER, height=1).pack(fill="x", pady=10)

    def _info_row(self, parent, label, value):
        row = tk.Frame(parent, bg=BG_CARD)
        row.pack(fill="x", pady=2)
        tk.Label(row, text=label, font=("Segoe UI", 8),
                 fg=FG_SUB, bg=BG_CARD, width=9, anchor="w").pack(side="left")
        tk.Label(row, text=str(value) if value else "—",
                 font=("Consolas", 8), fg=FG_TEXT, bg=BG_CARD,
                 wraplength=330, justify="left").pack(side="left", fill="x", expand=True)

    def _btn(self, parent, text, cmd, color, expand=True):
        b = tk.Button(parent, text=text, command=cmd,
                      font=("Segoe UI", 9, "bold"),
                      bg=color, fg="#ffffff",
                      relief="flat", padx=14, pady=7,
                      cursor="hand2",
                      activebackground=color,
                      activeforeground="#ffffff")
        if expand:
            b.pack(fill="x", pady=(0, 6))
        return b

    def _btn_row(self, parent, buttons):
        """Row of equally-sized buttons: buttons = [(text, cmd, color), ...]"""
        row = tk.Frame(parent, bg=BG_CARD)
        row.pack(fill="x", pady=(0, 6))
        for i, (text, cmd, color) in enumerate(buttons):
            px = (0, 4) if i < len(buttons) - 1 else (4, 0)
            if i == 0:
                px = (0, 3)
            b = tk.Button(row, text=text, command=cmd,
                          font=("Segoe UI", 9, "bold"),
                          bg=color, fg="#ffffff",
                          relief="flat", padx=10, pady=7,
                          cursor="hand2",
                          activebackground=color,
                          activeforeground="#ffffff")
            b.pack(side="left", expand=True, fill="x", padx=(0 if i == 0 else 3, 0))

    def _entry_field(self, parent, var, placeholder=""):
        e = tk.Entry(parent, textvariable=var,
                     font=("Consolas", 9),
                     bg=BG_INPUT, fg=FG_TEXT,
                     insertbackground=FG_TEXT,
                     relief="flat", bd=7)
        e.pack(fill="x", ipady=3, pady=(0, 10))
        return e

    def _status_indicator(self, parent, icon, title, subtitle, icon_color):
        row = tk.Frame(parent, bg=BG_CARD)
        row.pack(fill="x", pady=(0, 10))
        tk.Label(row, text=icon, font=("Segoe UI", 22, "bold"),
                 fg=icon_color, bg=BG_CARD).pack(side="left", padx=(0, 12))
        right = tk.Frame(row, bg=BG_CARD)
        right.pack(side="left", fill="x", expand=True)
        tk.Label(right, text=title, font=("Segoe UI", 10, "bold"),
                 fg=icon_color, bg=BG_CARD, anchor="w").pack(fill="x")
        tk.Label(right, text=subtitle, font=("Segoe UI", 8),
                 fg=FG_SUB, bg=BG_CARD, anchor="w").pack(fill="x")

    # ── SCREEN: Connect ──────────────────────────────────────

    def _show_connect_screen(self):
        self._clear()
        self._set_status("Non connecté")

        cfg = load_config()
        injected = DEFAULT_SERVER if "##" not in DEFAULT_SERVER else ""
        saved = cfg.get("server_url", "") or injected

        f = self._centered()

        if saved:
            tk.Label(f, text="Dernier serveur connu :",
                     font=("Segoe UI", 8), fg=FG_SUB, bg=BG_CARD).pack(anchor="w")

            saved_frame = tk.Frame(f, bg=BG_INPUT)
            saved_frame.pack(fill="x", pady=(4, 12), ipady=2)
            tk.Label(saved_frame, text=saved,
                     font=("Consolas", 9, "bold"), fg=FG_BLUE, bg=BG_INPUT,
                     wraplength=380, justify="left").pack(padx=10, pady=6, anchor="w")

            self._btn(f, "Se reconnecter", lambda: self._do_connect(saved), FG_GREEN)
            self._sep(f)

            tk.Label(f, text="Ou entrez une autre adresse :",
                     font=("Segoe UI", 8), fg=FG_SUB, bg=BG_CARD).pack(anchor="w", pady=(0, 6))
            var = tk.StringVar()
            entry = self._entry_field(f, var)
            entry.bind("<Return>", lambda _e: self._connect_from_entry(var))
            self._btn(f, "Autre serveur", lambda: self._connect_from_entry(var), FG_BLUE)

        else:
            tk.Label(f, text="Adresse du serveur :",
                     font=("Segoe UI", 8), fg=FG_SUB, bg=BG_CARD).pack(anchor="w", pady=(0, 6))
            var = tk.StringVar()
            entry = self._entry_field(f, var)
            entry.focus_set()
            entry.bind("<Return>", lambda _e: self._connect_from_entry(var))
            self._btn(f, "Se connecter", lambda: self._connect_from_entry(var), FG_BLUE)

    # ── SCREEN: Connecting ───────────────────────────────────

    def _show_connecting_screen(self, url):
        self._clear()
        self._set_status("Connexion en cours…", FG_ORANGE)

        f = self._centered()
        tk.Label(f, text="Connexion en cours…",
                 font=("Segoe UI", 10), fg=FG_TEXT, bg=BG_CARD).pack(pady=(0, 8))
        tk.Label(f, text=url, font=("Consolas", 9),
                 fg=FG_BLUE, bg=BG_CARD,
                 wraplength=420, justify="center").pack()

    # ── SCREEN: Running ──────────────────────────────────────

    def _show_running_screen(self):
        self._clear()
        self._set_status("● En ligne", FG_GREEN)

        f = self._centered()

        self._status_indicator(f, "✓", "Connecté · envoi actif",
                               f"Toutes les {INTERVAL_SEC}s  ·  Machine : {AGENT_NAME}",
                               FG_GREEN)
        self._sep(f)

        self._info_row(f, "Serveur", self.server_url)
        self._info_row(f, "ID", MACHINE_ID)

        self._sep(f)

        self._run_status_lbl = tk.Label(f, text="Envoi en cours…",
                                        font=("Segoe UI", 8), fg=FG_SUB, bg=BG_CARD)
        self._run_status_lbl.pack(pady=(0, 12))

        self._btn(f, "Se déconnecter", self._do_stop, FG_RED)
        self._tick()

    # ── SCREEN: Stopped ──────────────────────────────────────

    def _show_stopped_screen(self):
        self._clear()
        self._set_status("Déconnecté", FG_ORANGE)

        f = self._centered()

        self._status_indicator(f, "●", "Déconnecté",
                               "Aucune métrique envoyée", FG_ORANGE)
        self._sep(f)
        self._info_row(f, "Serveur", self.server_url)
        self._sep(f)

        self._btn_row(f, [
            ("Relancer", self._do_restart, FG_GREEN),
            ("Changer de serveur", self._show_connect_screen, FG_BLUE),
        ])
        self._btn(f, "Quitter", self._quit, "#374151")

    # ── SCREEN: Error ────────────────────────────────────────

    def _show_error_screen(self, url, err):
        self._clear()
        self._set_status("Erreur de connexion", FG_RED)

        f = self._centered()

        self._status_indicator(f, "✕", "Connexion échouée",
                               (err[:64] if err else "Vérifiez l'URL et votre connexion"),
                               FG_RED)
        self._sep(f)
        self._info_row(f, "Serveur", url)
        self._sep(f)

        self._btn_row(f, [
            ("Réessayer", lambda: self._do_connect(url), FG_GREEN),
            ("Changer de serveur", self._show_connect_screen, FG_BLUE),
        ])

    # ── Tick (running screen update) ─────────────────────────

    def _tick(self):
        try:
            lbl = self._run_status_lbl
            if lbl and lbl.winfo_exists():
                if self.last_error:
                    lbl.config(text=f"Erreur : {self.last_error[:56]}", fg=FG_ORANGE)
                elif self.last_ok:
                    elapsed = int(time.time() - self.last_ok)
                    lbl.config(
                        text=f"Dernier envoi : il y a {elapsed}s  ·  Total : {self.send_count}",
                        fg=FG_SUB)
        except Exception:
            pass
        self._tick_job = self.root.after(1000, self._tick)

    # ── Actions ──────────────────────────────────────────────

    def _on_close(self):
        self.root.iconify()

    def _connect_from_entry(self, var):
        val = var.get().strip().rstrip("/")
        if not val:
            return
        if not val.startswith("http"):
            val = "http://" + val
        self._do_connect(val)

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
        if self.server_url:
            threading.Thread(
                target=send_disconnect, args=(self.server_url,), daemon=True
            ).start()
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
    print("  L2-IG2 Monitor Agent")
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
        send_disconnect(server_url)
        print("\nAgent arrêté.")


# ─────────────────────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────────────────────

def main():
    global AGENT_NAME, INTERVAL_SEC

    parser = argparse.ArgumentParser(description="L2-IG2 Monitor Agent")
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
