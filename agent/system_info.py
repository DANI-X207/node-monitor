import psutil
import platform
import socket
import subprocess
import uuid
import time
import re

def get_mac_address():
    try:
        mac_int = uuid.getnode()
        mac_hex = ':'.join(('%012X' % mac_int)[i:i+2] for i in range(0, 12, 2))
        return mac_hex.lower()
    except:
        return str(uuid.uuid4())

def get_machine_id():
    return get_mac_address()

def get_cpu_model():
    try:
        system = platform.system()
        if system == 'Windows':
            result = subprocess.check_output(
                'wmic cpu get Name', shell=True, text=True
            )
            lines = [l.strip() for l in result.strip().splitlines() if l.strip()]
            if len(lines) > 1:
                return lines[1]
        elif system == 'Linux':
            with open('/proc/cpuinfo', 'r') as f:
                for line in f:
                    if 'model name' in line:
                        return line.split(':')[1].strip()
        elif system == 'Darwin':
            result = subprocess.check_output(
                ['sysctl', '-n', 'machdep.cpu.brand_string'], text=True
            )
            return result.strip()
    except:
        pass
    return platform.processor() or 'Unknown CPU'

def get_uptime_seconds():
    return int(time.time() - psutil.boot_time())

def format_uptime(seconds):
    days = seconds // 86400
    hours = (seconds % 86400) // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    if days > 0:
        return f"{days}j {hours}h {minutes}m {secs}s"
    elif hours > 0:
        return f"{hours}h {minutes}m {secs}s"
    else:
        return f"{minutes}m {secs}s"

def get_disk_info():
    disks = []
    seen = set()
    for part in psutil.disk_partitions(all=False):
        try:
            if part.mountpoint in seen:
                continue
            seen.add(part.mountpoint)
            usage = psutil.disk_usage(part.mountpoint)
            disks.append({
                'device': part.device,
                'mountpoint': part.mountpoint,
                'fstype': part.fstype,
                'total_gb': round(usage.total / (1024 ** 3), 2),
                'used_gb': round(usage.used / (1024 ** 3), 2),
                'free_gb': round(usage.free / (1024 ** 3), 2),
                'percent': usage.percent
            })
        except (PermissionError, OSError):
            continue
    return disks

def get_machine_info():
    hostname = socket.gethostname()
    try:
        ip = socket.gethostbyname(hostname)
    except:
        ip = '127.0.0.1'

    uname = platform.uname()
    arch = platform.machine()
    os_version = platform.version()

    os_name = platform.system()
    if os_name == 'Windows':
        try:
            os_release = platform.win32_ver()
            os_display = f"Windows {os_release[0]}"
        except:
            os_display = f"Windows {platform.release()}"
    elif os_name == 'Darwin':
        try:
            mac_ver = platform.mac_ver()[0]
            os_display = f"macOS {mac_ver}"
        except:
            os_display = "macOS"
    else:
        try:
            import distro
            os_display = f"{distro.name()} {distro.version()}"
        except:
            os_display = f"Linux {platform.release()}"

    cpu_count_logical = psutil.cpu_count(logical=True)
    cpu_count_physical = psutil.cpu_count(logical=False)

    mac_addr = get_mac_address()

    return {
        'machine_id': mac_addr,
        'mac_address': mac_addr,
        'hostname': hostname,
        'ip_address': ip,
        'os_type': os_name,
        'os_display': os_display,
        'architecture': arch,
        'cpu_model': get_cpu_model(),
        'cpu_cores_physical': cpu_count_physical or 1,
        'cpu_cores_logical': cpu_count_logical or 1
    }

def collect_metrics():
    vm = psutil.virtual_memory()
    nio = psutil.net_io_counters()
    uptime_secs = get_uptime_seconds()

    return {
        'cpu_percent': psutil.cpu_percent(interval=1),
        'ram_percent': vm.percent,
        'ram_used_mb': round(vm.used / (1024 * 1024), 2),
        'ram_total_mb': round(vm.total / (1024 * 1024), 2),
        'ram_free_mb': round(vm.available / (1024 * 1024), 2),
        'network_sent_mb': round(nio.bytes_sent / (1024 ** 2), 2),
        'network_recv_mb': round(nio.bytes_recv / (1024 ** 2), 2),
        'uptime_seconds': uptime_secs,
        'uptime_display': format_uptime(uptime_secs),
        'disks': get_disk_info(),
        'gpu_percent': None
    }
