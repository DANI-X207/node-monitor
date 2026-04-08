const db = require('../database');

module.exports = (io) => {
  const connectedAgents = {};

  io.on('connection', (socket) => {
    console.log(`Nouvel agent connecté: ${socket.id}`);

    socket.on('connect_agent', async (data) => {
      const machineId = data.machine_id;
      connectedAgents[machineId] = {
        socketId: socket.id,
        ...data,
        connectedAt: new Date()
      };

      await db.addMachine({
        machine_id: machineId,
        ip_address: data.ip_address,
        hostname: data.hostname,
        os_type: data.os_type
      });

      socket.emit('connection_confirmed', { status: 'connected', machine_id: machineId });
      io.emit('machine_connected', data);
      console.log(`✓ Machine enregistrée: ${data.hostname}`);
    });

    socket.on('system_metrics', async (data) => {
      const machineId = data.machine_id;
      await db.recordMetrics(machineId, data);
      io.emit('metrics_update', { machine_id: machineId, metrics: data });
    });

    socket.on('disconnect', () => {
      for (let mid in connectedAgents) {
        if (connectedAgents[mid].socketId === socket.id) {
          io.emit('machine_disconnected', { machine_id: mid });
          delete connectedAgents[mid];
          console.log(`✗ Machine déconnectée: ${mid}`);
          break;
        }
      }
    });
  });
};