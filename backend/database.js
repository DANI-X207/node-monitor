const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;

const initializeDatabase = async () => {
  db = new Database(config.DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id TEXT UNIQUE NOT NULL,
      hostname TEXT,
      ip_address TEXT,
      os_type TEXT,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id TEXT NOT NULL,
      cpu_percent REAL,
      ram_percent REAL,
      ram_used_mb REAL,
      ram_total_mb REAL,
      disk_percent REAL,
      disk_used_gb REAL,
      disk_total_gb REAL,
      network_sent_mb REAL,
      network_recv_mb REAL,
      gpu_percent REAL,
      gpu_memory_percent REAL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (machine_id) REFERENCES machines(machine_id)
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_machine_id ON metrics(machine_id);
    CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
  `);

  console.log('Database initialized successfully');
};

const addMachine = async ({ machine_id, hostname, ip_address, os_type }) => {
  const stmt = db.prepare(`
    INSERT INTO machines (machine_id, hostname, ip_address, os_type, last_seen)
    VALUES (@machine_id, @hostname, @ip_address, @os_type, CURRENT_TIMESTAMP)
    ON CONFLICT(machine_id) DO UPDATE SET
      hostname = @hostname,
      ip_address = @ip_address,
      os_type = @os_type,
      last_seen = CURRENT_TIMESTAMP
  `);
  return stmt.run({ machine_id, hostname, ip_address, os_type });
};

const getMachines = async () => {
  const stmt = db.prepare('SELECT * FROM machines ORDER BY last_seen DESC');
  return stmt.all();
};

const getMachineById = async (machine_id) => {
  const stmt = db.prepare('SELECT * FROM machines WHERE machine_id = ?');
  return stmt.get(machine_id);
};

const recordMetrics = async (machine_id, data) => {
  db.prepare(`
    UPDATE machines SET last_seen = CURRENT_TIMESTAMP WHERE machine_id = ?
  `).run(machine_id);

  const stmt = db.prepare(`
    INSERT INTO metrics (
      machine_id, cpu_percent, ram_percent, ram_used_mb, ram_total_mb,
      disk_percent, disk_used_gb, disk_total_gb,
      network_sent_mb, network_recv_mb, gpu_percent, gpu_memory_percent
    ) VALUES (
      @machine_id, @cpu_percent, @ram_percent, @ram_used_mb, @ram_total_mb,
      @disk_percent, @disk_used_gb, @disk_total_gb,
      @network_sent_mb, @network_recv_mb, @gpu_percent, @gpu_memory_percent
    )
  `);

  return stmt.run({
    machine_id,
    cpu_percent: data.cpu_percent ?? null,
    ram_percent: data.ram_percent ?? null,
    ram_used_mb: data.ram_used_mb ?? null,
    ram_total_mb: data.ram_total_mb ?? null,
    disk_percent: data.disk_percent ?? null,
    disk_used_gb: data.disk_used_gb ?? null,
    disk_total_gb: data.disk_total_gb ?? null,
    network_sent_mb: data.network_sent_mb ?? null,
    network_recv_mb: data.network_recv_mb ?? null,
    gpu_percent: data.gpu_percent ?? null,
    gpu_memory_percent: data.gpu_memory_percent ?? null
  });
};

const getLatestMetrics = async (machine_id) => {
  const stmt = db.prepare(`
    SELECT * FROM metrics
    WHERE machine_id = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `);
  return stmt.get(machine_id);
};

const getMetricsHistory = async (machine_id, hours = 24) => {
  const stmt = db.prepare(`
    SELECT * FROM metrics
    WHERE machine_id = ?
      AND timestamp >= datetime('now', '-' || ? || ' hours')
    ORDER BY timestamp ASC
  `);
  return stmt.all(machine_id, hours);
};

const cleanupOldMetrics = () => {
  const retentionHours = config.METRICS_RETENTION_HOURS || 24;
  const stmt = db.prepare(`
    DELETE FROM metrics
    WHERE timestamp < datetime('now', '-' || ? || ' hours')
  `);
  const result = stmt.run(retentionHours);
  if (result.changes > 0) {
    console.log(`Cleaned up ${result.changes} old metric records`);
  }
};

module.exports = {
  initializeDatabase,
  addMachine,
  getMachines,
  getMachineById,
  recordMetrics,
  getLatestMetrics,
  getMetricsHistory,
  cleanupOldMetrics
};
