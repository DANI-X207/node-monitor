const db = require('../database');

module.exports = (io) => {
  const connectedAgents = {};

  io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    socket.on('connect_agent', async (data) => {
      const machineId = data.machine_id;
      connectedAgents[machineId] = {
        socketId: socket.id,
        ...data,
        connectedAt: new Date()
      };

      await db.addMachine({
        machine_id: machineId,
        mac_address: data.mac_address || machineId,
        ip_address: data.ip_address,
        hostname: data.hostname,
        os_type: data.os_type,
        os_display: data.os_display || data.os_type,
        architecture: data.architecture,
        cpu_model: data.cpu_model,
        cpu_cores_physical: data.cpu_cores_physical,
        cpu_cores_logical: data.cpu_cores_logical
      });

      socket.emit('connection_confirmed', { status: 'connected', machine_id: machineId });
      io.emit('machine_connected', { ...data, status: 'online' });
      console.log(`Machine registered: ${data.hostname} (${machineId})`);
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
          console.log(`Machine disconnected: ${mid}`);
          break;
        }
      }
    });
  });

  return connectedAgents;
};
