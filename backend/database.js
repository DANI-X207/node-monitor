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
      mac_address TEXT,
      hostname TEXT,
      ip_address TEXT,
      os_type TEXT,
      os_display TEXT,
      architecture TEXT,
      cpu_model TEXT,
      cpu_cores_physical INTEGER,
      cpu_cores_logical INTEGER,
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
      ram_free_mb REAL,
      network_sent_mb REAL,
      network_recv_mb REAL,
      uptime_seconds INTEGER,
      uptime_display TEXT,
      disks TEXT,
      gpu_percent REAL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (machine_id) REFERENCES machines(machine_id)
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_machine_id ON metrics(machine_id);
    CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
  `);

  try { db.exec(`ALTER TABLE machines ADD COLUMN mac_address TEXT`); } catch(e) {}
  try { db.exec(`ALTER TABLE machines ADD COLUMN os_display TEXT`); } catch(e) {}
  try { db.exec(`ALTER TABLE machines ADD COLUMN architecture TEXT`); } catch(e) {}
  try { db.exec(`ALTER TABLE machines ADD COLUMN cpu_model TEXT`); } catch(e) {}
  try { db.exec(`ALTER TABLE machines ADD COLUMN cpu_cores_physical INTEGER`); } catch(e) {}
  try { db.exec(`ALTER TABLE machines ADD COLUMN cpu_cores_logical INTEGER`); } catch(e) {}
  try { db.exec(`ALTER TABLE machines ADD COLUMN ip_addresses TEXT`); } catch(e) {}
  try { db.exec(`ALTER TABLE metrics ADD COLUMN ram_free_mb REAL`); } catch(e) {}
  try { db.exec(`ALTER TABLE metrics ADD COLUMN uptime_seconds INTEGER`); } catch(e) {}
  try { db.exec(`ALTER TABLE metrics ADD COLUMN uptime_display TEXT`); } catch(e) {}
  try { db.exec(`ALTER TABLE metrics ADD COLUMN disks TEXT`); } catch(e) {}

  console.log('Database initialized');
};

const addMachine = async (data) => {
  const stmt = db.prepare(`
    INSERT INTO machines (machine_id, mac_address, hostname, ip_address, ip_addresses, os_type, os_display, architecture, cpu_model, cpu_cores_physical, cpu_cores_logical, last_seen)
    VALUES (@machine_id, @mac_address, @hostname, @ip_address, @ip_addresses, @os_type, @os_display, @architecture, @cpu_model, @cpu_cores_physical, @cpu_cores_logical, CURRENT_TIMESTAMP)
    ON CONFLICT(machine_id) DO UPDATE SET
      mac_address = @mac_address,
      hostname = @hostname,
      ip_address = @ip_address,
      ip_addresses = @ip_addresses,
      os_type = @os_type,
      os_display = @os_display,
      architecture = @architecture,
      cpu_model = @cpu_model,
      cpu_cores_physical = @cpu_cores_physical,
      cpu_cores_logical = @cpu_cores_logical,
      last_seen = CURRENT_TIMESTAMP
  `);
  return stmt.run({
    machine_id: data.machine_id,
    mac_address: data.mac_address || data.machine_id,
    hostname: data.hostname,
    ip_address: data.ip_address,
    ip_addresses: data.ip_addresses || null,
    os_type: data.os_type,
    os_display: data.os_display || data.os_type,
    architecture: data.architecture || null,
    cpu_model: data.cpu_model || null,
    cpu_cores_physical: data.cpu_cores_physical || null,
    cpu_cores_logical: data.cpu_cores_logical || null
  });
};

const getMachines = async () => {
  return db.prepare('SELECT * FROM machines ORDER BY last_seen DESC').all();
};

const getMachineById = async (machine_id) => {
  return db.prepare('SELECT * FROM machines WHERE machine_id = ?').get(machine_id);
};

const getMachineByMac = async (mac_address) => {
  return db.prepare('SELECT * FROM machines WHERE mac_address = ? OR machine_id = ?').get(mac_address, mac_address);
};

const recordMetrics = async (machine_id, data) => {
  db.prepare(`UPDATE machines SET last_seen = CURRENT_TIMESTAMP WHERE machine_id = ?`).run(machine_id);

  const stmt = db.prepare(`
    INSERT INTO metrics (
      machine_id, cpu_percent, ram_percent, ram_used_mb, ram_total_mb, ram_free_mb,
      network_sent_mb, network_recv_mb, uptime_seconds, uptime_display, disks, gpu_percent
    ) VALUES (
      @machine_id, @cpu_percent, @ram_percent, @ram_used_mb, @ram_total_mb, @ram_free_mb,
      @network_sent_mb, @network_recv_mb, @uptime_seconds, @uptime_display, @disks, @gpu_percent
    )
  `);

  return stmt.run({
    machine_id,
    cpu_percent: data.cpu_percent ?? null,
    ram_percent: data.ram_percent ?? null,
    ram_used_mb: data.ram_used_mb ?? null,
    ram_total_mb: data.ram_total_mb ?? null,
    ram_free_mb: data.ram_free_mb ?? null,
    network_sent_mb: data.network_sent_mb ?? null,
    network_recv_mb: data.network_recv_mb ?? null,
    uptime_seconds: data.uptime_seconds ?? null,
    uptime_display: data.uptime_display ?? null,
    disks: data.disks ? JSON.stringify(data.disks) : null,
    gpu_percent: data.gpu_percent ?? null
  });
};

const getLatestMetrics = async (machine_id) => {
  const row = db.prepare(`SELECT * FROM metrics WHERE machine_id = ? ORDER BY timestamp DESC LIMIT 1`).get(machine_id);
  if (row && row.disks) {
    try { row.disks = JSON.parse(row.disks); } catch(e) { row.disks = []; }
  }
  return row;
};

const getMetricsHistory = async (machine_id, hours = 24) => {
  const rows = db.prepare(`
    SELECT * FROM metrics
    WHERE machine_id = ? AND timestamp >= datetime('now', '-' || ? || ' hours')
    ORDER BY timestamp ASC
  `).all(machine_id, hours);
  return rows.map(r => {
    if (r.disks) { try { r.disks = JSON.parse(r.disks); } catch(e) { r.disks = []; } }
    return r;
  });
};

const cleanupOldMetrics = () => {
  const retentionHours = config.METRICS_RETENTION_HOURS || 24;
  const result = db.prepare(`DELETE FROM metrics WHERE timestamp < datetime('now', '-' || ? || ' hours')`).run(retentionHours);
  if (result.changes > 0) console.log(`Cleaned up ${result.changes} old metric records`);
};

module.exports = {
  initializeDatabase,
  addMachine,
  getMachines,
  getMachineById,
  getMachineByMac,
  recordMetrics,
  getLatestMetrics,
  getMetricsHistory,
  cleanupOldMetrics
};
