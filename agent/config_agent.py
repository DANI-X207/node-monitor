import os
from dotenv import load_dotenv

load_dotenv()

SERVER_URL = os.getenv('AGENT_SERVER_URL', 'http://localhost:5000')
AGENT_UPDATE_INTERVAL = int(os.getenv('AGENT_UPDATE_INTERVAL', 5))
SOCKET_TIMEOUT = int(os.getenv('SOCKET_TIMEOUT', 30))
RECONNECT_ATTEMPTS = int(os.getenv('RECONNECT_ATTEMPTS', 0))
RECONNECT_DELAY = int(os.getenv('RECONNECT_DELAY', 5))
AGENT_VERSION = '1.0.0'
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
LOG_FILE = os.getenv('LOG_FILE', 'agent.log')

if AGENT_UPDATE_INTERVAL < 1 or AGENT_UPDATE_INTERVAL > 60:
    AGENT_UPDATE_INTERVAL = 5