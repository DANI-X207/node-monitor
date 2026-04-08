import socketio
import time
import logging
import signal
import sys
from system_info import get_machine_info, collect_metrics
from config_agent import *

logging.basicConfig(
    level=LOG_LEVEL,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class MonitoringAgent:
    def __init__(self):
        self.sio = socketio.Client(
            reconnection=True,
            reconnection_attempts=RECONNECT_ATTEMPTS,
            reconnection_delay=RECONNECT_DELAY,
            reconnection_delay_max=10,
            ping_interval=5,
            ping_timeout=SOCKET_TIMEOUT
        )
        self.machine_info = None
        self.running = True
        self.setup_handlers()

    def setup_handlers(self):
        @self.sio.on('connect')
        def on_connect():
            logger.info('Connected to server')
            self.send_connection_info()

        @self.sio.on('disconnect')
        def on_disconnect():
            logger.warning('Disconnected from server')

        @self.sio.on('connection_confirmed')
        def on_connection_confirmed(data):
            logger.info(f'Connection confirmed: {data}')

    def connect(self):
        try:
            logger.info(f'Connecting to {SERVER_URL}...')
            self.sio.connect(SERVER_URL, wait_timeout=10)
            return True
        except Exception as e:
            logger.error(f'Connection error: {e}')
            return False

    def disconnect(self):
        if self.sio.connected:
            self.sio.disconnect()

    def send_connection_info(self):
        try:
            self.machine_info = get_machine_info()
            self.sio.emit('connect_agent', self.machine_info)
            logger.info(f'Info sent: {self.machine_info["hostname"]} (MAC: {self.machine_info["mac_address"]})')
        except Exception as e:
            logger.error(f'Error sending info: {e}')

    def send_metrics(self):
        try:
            if not self.sio.connected:
                return
            metrics = collect_metrics()
            metrics['machine_id'] = self.machine_info['machine_id']
            self.sio.emit('system_metrics', metrics)
            logger.debug(f'CPU={metrics["cpu_percent"]}% RAM={metrics["ram_percent"]}% Uptime={metrics["uptime_display"]}')
        except Exception as e:
            logger.error(f'Error sending metrics: {e}')

    def run(self):
        logger.info('Starting agent...')
        if not self.connect():
            logger.error('Cannot connect to server')
            sys.exit(1)

        try:
            while self.running:
                if self.sio.connected:
                    self.send_metrics()
                time.sleep(AGENT_UPDATE_INTERVAL)
        except KeyboardInterrupt:
            logger.info('Shutting down...')
        finally:
            self.disconnect()

    def stop(self):
        logger.info('Stopping agent...')
        self.running = False
        self.disconnect()

def signal_handler(signum, frame):
    agent.stop()
    sys.exit(0)

if __name__ == '__main__':
    agent = MonitoringAgent()
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    try:
        agent.run()
    except KeyboardInterrupt:
        agent.stop()
