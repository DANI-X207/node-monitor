const socket = io();
let machineCharts = {};

socket.on('connect', () => {
    document.getElementById('connection-status').textContent = '● Connecté';
    document.getElementById('connection-status').classList.remove('offline');
    document.getElementById('connection-status').classList.add('online');
});

socket.on('disconnect', () => {
    document.getElementById('connection-status').textContent = '● Déconnecté';
    document.getElementById('connection-status').classList.remove('online');
    document.getElementById('connection-status').classList.add('offline');
});

socket.on('machine_connected', (data) => {
    fetchAllMachines();
});

socket.on('metrics_update', (data) => {
    updateMachineMetrics(data.machine_id, data.metrics);
});

function fetchAllMachines() {
    fetch('/api/machines')
        .then(r => r.json())
        .then(machines => {
            document.getElementById('machines-container').innerHTML = '';
            machines.forEach(m => renderMachine(m));
        });
}

function renderMachine(machine) {
    const card = document.createElement('div');
    card.className = `machine-card ${machine.status === 'online' ? '' : 'offline'}`;
    card.dataset.machineId = machine.machine_id;

    const osIcon = machine.os === 'Windows' ? '🪟' : machine.os === 'Linux' ? '🐧' : '🍎';
    const statusBadge = `<span class="status-badge ${machine.status === 'online' ? 'online' : 'offline'}">● ${machine.status === 'online' ? 'En ligne' : 'Hors ligne'}</span>`;

    card.innerHTML = `
        <div class="card-header">
            <h3>${machine.hostname}</h3>
            ${statusBadge}
        </div>
        <div class="card-info">
            <div><strong>IP:</strong> ${machine.ip}</div>
            <div><span class="os-icon">${osIcon}</span> ${machine.os}</div>
        </div>
        <div class="metrics-section">
            <div class="metric">
                <span class="metric-label">CPU</span>
                <div class="metric-bar"><span class="metric-fill" style="width: ${machine.metrics.cpu || 0}%"></span></div>
                <span class="metric-value">${Math.round(machine.metrics.cpu || 0)}%</span>
            </div>
            <div class="metric">
                <span class="metric-label">RAM</span>
                <div class="metric-bar"><span class="metric-fill" style="width: ${machine.metrics.ram || 0}%"></span></div>
                <span class="metric-value">${Math.round(machine.metrics.ram || 0)}%</span>
            </div>
            <div class="metric">
                <span class="metric-label">DISK</span>
                <div class="metric-bar"><span class="metric-fill" style="width: ${machine.metrics.disk || 0}%"></span></div>
                <span class="metric-value">${Math.round(machine.metrics.disk || 0)}%</span>
            </div>
        </div>
    `;

    card.addEventListener('click', () => openMachineDetails(machine.machine_id));
    document.getElementById('machines-container').appendChild(card);
}

function openMachineDetails(machineId) {
    fetch(`/api/machines/${machineId}`)
        .then(r => r.json())
        .then(machine => {
            document.getElementById('modal-hostname').textContent = machine.hostname;
            document.getElementById('modal-ip').textContent = machine.ip;
            document.getElementById('modal-os').textContent = machine.os;

            fetchAndRenderHistory(machineId);
            document.getElementById('machine-detail-modal').style.display = 'block';
        });
}

function fetchAndRenderHistory(machineId) {
    fetch(`/api/machines/${machineId}/history?hours=24`)
        .then(r => r.json())
        .then(history => {
            const labels = history.map(m => new Date(m.timestamp).toLocaleTimeString());
            renderChart('chart-cpu', labels, history.map(m => m.cpu), 'CPU %');
            renderChart('chart-ram', labels, history.map(m => m.ram), 'RAM %');
            renderChart('chart-disk', labels, history.map(m => m.disk), 'DISK %');
        });
}

function renderChart(canvasId, labels, data, label) {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    if (machineCharts[canvasId]) machineCharts[canvasId].destroy();

    machineCharts[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                borderColor: '#3498db',
                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, max: 100 } }
        }
    });
}

function updateMachineMetrics(machineId, metrics) {
    const card = document.querySelector(`[data-machine-id="${machineId}"]`);
    if (card) {
        card.querySelector('[style*="cpu"]').style.width = metrics.cpu_percent + '%';
        card.querySelector('[style*="ram"]').style.width = metrics.ram_percent + '%';
    }
}

document.querySelector('.close')?.addEventListener('click', () => {
    document.getElementById('machine-detail-modal').style.display = 'none';
});

setInterval(fetchAllMachines, 10000);
fetchAllMachines();