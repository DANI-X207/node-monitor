const express = require('express');
const db = require('../database');

module.exports = (io) => {
  const router = express.Router();

  router.get('/machines', async (req, res) => {
    try {
      const machines = await db.getMachines();
      const result = [];

      for (const machine of machines) {
        const metrics = await db.getLatestMetrics(machine.machine_id);
        result.push({
          machine_id: machine.machine_id,
          hostname: machine.hostname,
          ip: machine.ip_address,
          os: machine.os_type,
          status: 'online',
          last_seen: machine.last_seen,
          metrics: metrics ? {
            cpu: metrics.cpu_percent,
            ram: metrics.ram_percent,
            gpu: metrics.gpu_percent,
            disk: metrics.disk_percent
          } : {}
        });
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  router.get('/machines/:machineId', async (req, res) => {
    try {
      const machine = await db.getMachineById(req.params.machineId);
      if (!machine) return res.status(404).json({ error: 'Machine non trouvée' });

      const metrics = await db.getLatestMetrics(machine.machine_id);

      res.json({
        machine_id: machine.machine_id,
        hostname: machine.hostname,
        ip: machine.ip_address,
        os: machine.os_type,
        status: 'online',
        last_seen: machine.last_seen,
        latest_metrics: metrics || {}
      });
    } catch (err) {
      res.status(500).json({ error: 'Erreur serveur' });
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
        gpu: m.gpu_percent,
        disk: m.disk_percent,
        network_sent: m.network_sent_mb,
        network_recv: m.network_recv_mb
      })));
    } catch (err) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  return router;
};