const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../database');

function formatUptime(seconds) {
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}j ${h}h ${m}m ${sec}s`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

function lastSeenDisplay(lastSeenStr) {
  const lastSeenDate = new Date(lastSeenStr + ' UTC');
  const diffSecs = Math.floor((Date.now() - lastSeenDate.getTime()) / 1000);
  if (diffSecs < 60) return `Il y a ${diffSecs}s`;
  if (diffSecs < 3600) return `Il y a ${Math.floor(diffSecs / 60)}min`;
  if (diffSecs < 86400) return `Il y a ${Math.floor(diffSecs / 3600)}h`;
  return `Il y a ${Math.floor(diffSecs / 86400)}j`;
}

module.exports = (io) => {
  const router = express.Router();

  router.post('/agent-report', async (req, res) => {
    try {
      const data = req.body;
      if (!data || !data.agentId) return res.status(400).json({ error: 'Missing agentId' });

      const machineId = data.agentId;
      const firstIp = (data.ips?.[0] || '').split(':').pop() || '';
      const osDisplay = data.os || data.platform || 'Unknown';
      const osType = osDisplay.split(' ')[0];

      await db.addMachine({
        machine_id: machineId,
        mac_address: machineId,
        hostname: data.hostname || data.name || 'Unknown',
        ip_address: firstIp,
        os_type: osType,
        os_display: osDisplay,
        architecture: data.arch || null,
        cpu_model: data.cpu?.model || null,
        cpu_cores_physical: data.cpu?.physicalCores || null,
        cpu_cores_logical: data.cpu?.cores || null
      });

      const uptime = Math.floor(data.uptime || 0);
      const disksMapped = (data.disk || []).map(d => ({
        device: d.mount,
        mountpoint: d.mount,
        total_gb: (d.total || 0) / (1024 ** 3),
        used_gb: (d.used || 0) / (1024 ** 3),
        free_gb: (d.free || 0) / (1024 ** 3),
        percent: d.percent || 0
      }));

      const metrics = {
        cpu_percent: parseFloat(data.cpu?.loadPercent) || 0,
        ram_percent: parseFloat(data.memory?.usedPercent) || 0,
        ram_used_mb: (data.memory?.used || 0) / (1024 * 1024),
        ram_total_mb: (data.memory?.total || 0) / (1024 * 1024),
        ram_free_mb: (data.memory?.free || 0) / (1024 * 1024),
        network_sent_mb: (data.network?.tx || 0) / (1024 * 1024),
        network_recv_mb: (data.network?.rx || 0) / (1024 * 1024),
        uptime_seconds: uptime,
        uptime_display: formatUptime(uptime),
        disks: disksMapped,
        gpu_percent: null
      };

      await db.recordMetrics(machineId, metrics);

      io.emit('metrics_update', {
        machine_id: machineId,
        metrics: {
          cpu_percent: metrics.cpu_percent,
          ram_percent: metrics.ram_percent,
          ram_used_mb: metrics.ram_used_mb,
          ram_total_mb: metrics.ram_total_mb,
          ram_free_mb: metrics.ram_free_mb,
          network_sent_mb: metrics.network_sent_mb,
          network_recv_mb: metrics.network_recv_mb,
          uptime_display: metrics.uptime_display,
          disks: disksMapped,
          gpu_percent: null
        }
      });

      io.emit('machine_update', { machine_id: machineId });

      res.json({ ok: true });
    } catch (err) {
      console.error('agent-report error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.get('/machines', async (req, res) => {
    try {
      const machines = await db.getMachines();
      const result = [];
      for (const machine of machines) {
        const metrics = await db.getLatestMetrics(machine.machine_id);
        result.push({
          machine_id: machine.machine_id,
          hostname: machine.hostname,
          os_display: machine.os_display || machine.os_type,
          os_type: machine.os_type,
          architecture: machine.architecture,
          cpu_model: machine.cpu_model,
          cpu_cores_physical: machine.cpu_cores_physical,
          cpu_cores_logical: machine.cpu_cores_logical,
          last_seen: machine.last_seen,
          last_seen_display: lastSeenDisplay(machine.last_seen),
          metrics: metrics ? {
            cpu: metrics.cpu_percent,
            ram: metrics.ram_percent,
            ram_used_mb: metrics.ram_used_mb,
            ram_total_mb: metrics.ram_total_mb,
            ram_free_mb: metrics.ram_free_mb,
            network_sent_mb: metrics.network_sent_mb,
            network_recv_mb: metrics.network_recv_mb,
            uptime_display: metrics.uptime_display,
            disks: metrics.disks || [],
            gpu: metrics.gpu_percent
          } : {}
        });
      }
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.get('/machines/:machineId', async (req, res) => {
    try {
      const machine = await db.getMachineById(req.params.machineId);
      if (!machine) return res.status(404).json({ error: 'Machine not found' });
      const metrics = await db.getLatestMetrics(machine.machine_id);
      res.json({
        machine_id: machine.machine_id,
        hostname: machine.hostname,
        os_display: machine.os_display || machine.os_type,
        os_type: machine.os_type,
        architecture: machine.architecture,
        cpu_model: machine.cpu_model,
        cpu_cores_physical: machine.cpu_cores_physical,
        cpu_cores_logical: machine.cpu_cores_logical,
        last_seen: machine.last_seen,
        last_seen_display: lastSeenDisplay(machine.last_seen),
        latest_metrics: metrics || {}
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.get('/machines/:machineId/history', async (req, res) => {
    try {
      const hours = parseInt(req.query.hours) || 24;
      const metrics = await db.getMetricsHistory(req.params.machineId, hours);
      res.json(metrics.map(m => ({
        timestamp: m.timestamp,
        cpu: m.cpu_percent,
        ram: m.ram_percent,
        network_sent: m.network_sent_mb,
        network_recv: m.network_recv_mb
      })));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.get('/download/agent', (req, res) => {
    const agentPath = path.join(__dirname, '../../agent/agent.py');
    if (!fs.existsSync(agentPath)) {
      return res.status(404).send('Agent not found');
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000';
    const serverUrl = `${protocol}://${host}`;

    let content = fs.readFileSync(agentPath, 'utf8');
    content = content.replace('##SERVER_URL##', serverUrl);

    res.setHeader('Content-Disposition', 'attachment; filename="agent.py"');
    res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
    res.send(content);
  });

  return router;
};
