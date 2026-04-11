module.exports = {
  PORT: process.env.PORT || 5000,
  HOST: '0.0.0.0',
  DB_PATH: process.env.DB_PATH || './data/monitoring.db',
  SOCKET_PING_INTERVAL: 10000,
  SOCKET_PING_TIMEOUT: 5000,
  METRICS_RETENTION_HOURS: 24,
  DEPLOY_PASSWORD: process.env.DEPLOY_PASSWORD || 'flemme'
};
