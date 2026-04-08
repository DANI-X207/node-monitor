import psutil
import platform
import socket
import subprocess
import uuid

def get_machine_id():
    try:
        if platform.system() == 'Windows':
            result = subprocess.check_output('wmic csproduct get uuid', shell=True, text=True)
            return result.split('\n')[1].strip()
    except:
        pass

    try:
        mac = subprocess.check_output('getmac', shell=True, text=True).split()[0]
        return mac.replace('-', ':').lower()
    except:
        return str(uuid.getnode())

def get_machine_info():
    hostname = socket.gethostname()
    try:
        ip = socket.gethostbyname(hostname)
    except:
        ip = '127.0.0.1'

    return {
        'machine_id': get_machine_id(),
        'hostname': hostname,
        'ip_address': ip,
        'os_type': platform.system()
    }

def collect_metrics():
    vm = psutil.virtual_memory()
    du = psutil.disk_usage('/')
    nio = psutil.net_io_counters()

    return {
        'cpu_percent': psutil.cpu_percent(interval=1),
        'ram_percent': vm.percent,
        'ram_used_mb': vm.used // (1024 * 1024),
        'ram_total_mb': vm.total // (1024 * 1024),
        'disk_percent': du.percent,
        'disk_used_gb': du.used / (1024 ** 3),
        'disk_total_gb': du.total / (1024 ** 3),
        'network_sent_mb': nio.bytes_sent / (1024 ** 2),
        'network_recv_mb': nio.bytes_recv / (1024 ** 2),
        'gpu_percent': None,
        'gpu_memory_percent': None
    }