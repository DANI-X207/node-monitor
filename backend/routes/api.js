const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../database');

module.exports = (io) => {
  const router = express.Router();

  router.get('/my-ip', (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.socket.remoteAddress
      || '';
    res.json({ ip: ip.replace('::ffff:', '') });
  });

  router.get('/machines', async (req, res) => {
    try {
      const machines = await db.getMachines();
      const result = [];

      for (const machine of machines) {
        const metrics = await db.getLatestMetrics(machine.machine_id);
        const lastSeenDate = new Date(machine.last_seen + ' UTC');
        const diffMs = Date.now() - lastSeenDate.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        let lastSeenDisplay;
        if (diffSecs < 60) lastSeenDisplay = `Il y a ${diffSecs}s`;
        else if (diffSecs < 3600) lastSeenDisplay = `Il y a ${Math.floor(diffSecs / 60)}min`;
        else if (diffSecs < 86400) lastSeenDisplay = `Il y a ${Math.floor(diffSecs / 3600)}h`;
        else lastSeenDisplay = `Il y a ${Math.floor(diffSecs / 86400)}j`;

        result.push({
          machine_id: machine.machine_id,
          mac_address: machine.mac_address,
          hostname: machine.hostname,
          os_display: machine.os_display || machine.os_type,
          os_type: machine.os_type,
          architecture: machine.architecture,
          cpu_model: machine.cpu_model,
          cpu_cores_physical: machine.cpu_cores_physical,
          cpu_cores_logical: machine.cpu_cores_logical,
          last_seen: machine.last_seen,
          last_seen_display: lastSeenDisplay,
          metrics: metrics ? {
            cpu: metrics.cpu_percent,
            ram: metrics.ram_percent,
            ram_used_mb: metrics.ram_used_mb,
            ram_total_mb: metrics.ram_total_mb,
            ram_free_mb: metrics.ram_free_mb,
            network_sent_mb: metrics.network_sent_mb,
            network_recv_mb: metrics.network_recv_mb,
            uptime_seconds: metrics.uptime_seconds,
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
      const lastSeenDate = new Date(machine.last_seen + ' UTC');
      const diffMs = Date.now() - lastSeenDate.getTime();
      const diffSecs = Math.floor(diffMs / 1000);
      let lastSeenDisplay;
      if (diffSecs < 60) lastSeenDisplay = `Il y a ${diffSecs}s`;
      else if (diffSecs < 3600) lastSeenDisplay = `Il y a ${Math.floor(diffSecs / 60)}min`;
      else if (diffSecs < 86400) lastSeenDisplay = `Il y a ${Math.floor(diffSecs / 3600)}h`;
      else lastSeenDisplay = `Il y a ${Math.floor(diffSecs / 86400)}j`;

      res.json({
        machine_id: machine.machine_id,
        mac_address: machine.mac_address,
        hostname: machine.hostname,
        os_display: machine.os_display || machine.os_type,
        os_type: machine.os_type,
        architecture: machine.architecture,
        cpu_model: machine.cpu_model,
        cpu_cores_physical: machine.cpu_cores_physical,
        cpu_cores_logical: machine.cpu_cores_logical,
        last_seen: machine.last_seen,
        last_seen_display: lastSeenDisplay,
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
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.setHeader('Content-Disposition', 'attachment; filename="agent.py"');
    res.setHeader('Content-Type', 'text/x-python');
    res.sendFile(agentPath);
  });

  return router;
};
