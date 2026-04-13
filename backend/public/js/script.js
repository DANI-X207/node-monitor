const socket = io();
let allMachines = [];
let myMachineId = null;

// v2 = efface les anciennes valeurs corrompues (source_ip era)
const STORAGE_KEY = 'myMachineId_v2';
localStorage.removeItem('myMachineId');
let currentModalMachineId = null;

const ONLINE_THRESHOLD_MS = 30000;

const MAX_HISTORY_POINTS = 60;
const machineHistory = {};
let modalChart = null;
let meChart = null;

function pushHistory(machineId, cpu, ram) {
    if (!machineHistory[machineId]) machineHistory[machineId] = [];
    const buf = machineHistory[machineId];
    buf.push({ time: new Date(), cpu: cpu ?? 0, ram: ram ?? 0 });
    if (buf.length > MAX_HISTORY_POINTS) buf.shift();
}

function makeChartConfig(buf) {
    const labels = buf.map(p => {
        const d = p.time;
        return d.getHours().toString().padStart(2,'0') + ':' +
               d.getMinutes().toString().padStart(2,'0') + ':' +
               d.getSeconds().toString().padStart(2,'0');
    });
    return {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'CPU %',
                    data: buf.map(p => p.cpu),
                    borderColor: '#4f8ef7',
                    backgroundColor: 'rgba(79,142,247,0.12)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2
                },
                {
                    label: 'RAM %',
                    data: buf.map(p => p.ram),
                    borderColor: '#3dd68c',
                    backgroundColor: 'rgba(61,214,140,0.10)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 150 },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1c2330',
                    titleColor: '#e6edf3',
                    bodyColor: '#8b949e',
                    borderColor: '#30363d',
                    borderWidth: 1,
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
                    }
                }
            },
            scales: {
                x: {
                    display: false
                },
                y: {
                    min: 0,
                    max: 100,
                    grid: { color: 'rgba(48,54,61,0.6)' },
                    ticks: {
                        color: '#8b949e',
                        font: { size: 10 },
                        callback: v => v + '%'
                    }
                }
            }
        }
    };
}

function updateChartData(chart, buf) {
    if (!chart) return;
    chart.data.labels = buf.map(p => {
        const d = p.time;
        return d.getHours().toString().padStart(2,'0') + ':' +
               d.getMinutes().toString().padStart(2,'0') + ':' +
               d.getSeconds().toString().padStart(2,'0');
    });
    chart.data.datasets[0].data = buf.map(p => p.cpu);
    chart.data.datasets[1].data = buf.map(p => p.ram);
    chart.update('none');
}

function initModalChart(machineId) {
    const canvas = document.getElementById('mm-chart');
    if (!canvas) return;
    if (modalChart) { modalChart.destroy(); modalChart = null; }
    const buf = machineHistory[machineId] || [];
    modalChart = new Chart(canvas, makeChartConfig(buf));
}

function initMeChart() {
    const canvas = document.getElementById('me-chart');
    if (!canvas) return;
    if (meChart) return;
    const buf = myMachineId ? (machineHistory[myMachineId] || []) : [];
    meChart = new Chart(canvas, makeChartConfig(buf));
}

function destroyMeChart() {
    if (meChart) { meChart.destroy(); meChart = null; }
}

async function setFrequency(val) {
    try {
        await fetch('/api/settings/interval', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ interval: parseInt(val) })
        });
    } catch(e) {
        console.error('setFrequency error:', e);
    }
}

async function loadCurrentInterval() {
    try {
        const res = await fetch('/api/settings/interval');
        const data = await res.json();
        const sel = document.getElementById('freqSelect');
        if (sel && data.interval) {
            const opt = sel.querySelector(`option[value="${data.interval}"]`);
            if (opt) sel.value = data.interval;
        }
    } catch(e) {}
}

socket.on('interval_changed', ({ interval }) => {
    const sel = document.getElementById('freqSelect');
    if (sel) sel.value = interval;
});

function formatUptime(totalSeconds) {
    const s = Math.floor(totalSeconds);
    if (s < 0) return '—';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d}j ${h}h ${m}m ${sec}s`;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    return `${m}m ${sec}s`;
}

function formatLastSeen(diffSeconds) {
    const s = Math.floor(diffSeconds);
    if (s < 5)  return 'À l\'instant';
    if (s < 60) return `Il y a ${s}s`;
    if (s < 3600) return `Il y a ${Math.floor(s / 60)}min`;
    if (s < 86400) return `Il y a ${Math.floor(s / 3600)}h`;
    return `Il y a ${Math.floor(s / 86400)}j`;
}

function mbToDisplay(mb) {
    if (mb == null) return '—';
    if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
    return mb.toFixed(0) + ' MB';
}

function isOnline(machine) {
    if (!machine._lastSeenAt) return false;
    return (Date.now() - machine._lastSeenAt) < ONLINE_THRESHOLD_MS;
}

function switchView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-link[data-view]').forEach(l => l.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    const navEl = document.querySelector(`[data-view="${view}"]`);
    if (navEl) navEl.classList.add('active');
    if (view === 'me') renderMyMachine();
    else destroyMeChart();
}

function toggleDownloadMenu() {
    document.querySelector('.download-wrapper').classList.toggle('open');
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.download-wrapper')) {
        document.querySelector('.download-wrapper').classList.remove('open');
    }
});

socket.on('connect', () => {
    document.getElementById('statusDot').classList.add('connected');
    document.getElementById('connectionStatus').textContent = 'Connecté';
});

socket.on('disconnect', () => {
    document.getElementById('statusDot').classList.remove('connected');
    document.getElementById('connectionStatus').textContent = 'Déconnecté';
});

socket.on('machine_update', () => {
    fetchMachines();
});

socket.on('machine_offline', (data) => {
    const machine = allMachines.find(m => m.machine_id === data.machine_id);
    if (machine) {
        machine._lastSeenAt = 0;
        updateMachineCard(machine);
        if (machine.machine_id === myMachineId) {
            const statusBadge = document.getElementById('myMachineStatus');
            if (statusBadge) {
                statusBadge.textContent = 'Hors ligne';
                statusBadge.className = 'badge badge-offline';
            }
        }
    }
});

socket.on('metrics_update', (data) => {
    let machine = allMachines.find(m => m.machine_id === data.machine_id);
    if (machine) {
        const now = Date.now();
        machine._lastSeenAt = now;
        machine._uptimeBase = data.uptime_seconds || 0;
        machine._uptimeAt = now;

        machine.metrics = {
            cpu: data.metrics.cpu_percent,
            ram: data.metrics.ram_percent,
            ram_used_mb: data.metrics.ram_used_mb,
            ram_total_mb: data.metrics.ram_total_mb,
            ram_free_mb: data.metrics.ram_free_mb,
            network_sent_mb: data.metrics.network_sent_mb,
            network_recv_mb: data.metrics.network_recv_mb,
            uptime_display: data.metrics.uptime_display,
            uptime_seconds: data.metrics.uptime_seconds,
            disks: data.metrics.disks || [],
            gpu: data.metrics.gpu_percent
        };

        if (data.ip_address) machine.ip_address = data.ip_address;
        if (data.ip_addresses) machine.ip_addresses = data.ip_addresses;
        if (data.interfaces && data.interfaces.length) machine.interfaces = data.interfaces;

        pushHistory(data.machine_id, data.metrics.cpu_percent, data.metrics.ram_percent);

        updateMachineCard(machine);
        if (machine.machine_id === myMachineId) {
            renderMyMachineMetrics(machine);
            renderMyMachineInterfaces(machine);
            if (meChart) updateChartData(meChart, machineHistory[machine.machine_id] || []);
        }
        if (machine.machine_id === currentModalMachineId) {
            fillMachineModal(machine);
            if (modalChart) updateChartData(modalChart, machineHistory[machine.machine_id] || []);
        }
    } else {
        fetchMachines();
    }
});

async function fetchMachines() {
    try {
        const res = await fetch('/api/machines');
        const fresh = await res.json();
        const now = Date.now();

        fresh.forEach(m => {
            const existing = allMachines.find(x => x.machine_id === m.machine_id);
            m._lastSeenAt = existing?._lastSeenAt || (new Date(m.last_seen + ' UTC').getTime());
            m._uptimeBase = m.metrics?.uptime_seconds || existing?._uptimeBase || 0;
            m._uptimeAt = existing?._uptimeAt || now;
            if (existing?.ip_address) m.ip_address = existing.ip_address;
            if (existing?.ip_addresses) m.ip_addresses = existing.ip_addresses;
            if (existing?.interfaces?.length) m.interfaces = existing.interfaces;
        });
        allMachines = fresh;

        renderGlobalView();
        const currentView = document.querySelector('.view.active')?.id;
        if (currentView === 'view-me') renderMyMachine();
    } catch(e) {
        console.error('Fetch error:', e);
    }
}

async function fetchMyMachineIp() {
    if (!myMachineId) return;
    try {
        const res = await fetch(`/api/machines/${myMachineId}`);
        if (!res.ok) return;
        const detail = await res.json();
        const machine = allMachines.find(m => m.machine_id === myMachineId);
        if (machine) {
            if (detail.ip_address) machine.ip_address = detail.ip_address;
            if (detail.ip_addresses?.length) machine.ip_addresses = detail.ip_addresses;
            renderMyMachineInterfaces(machine);
        }
    } catch(e) {}
}

function renderMyMachineInterfaces(machine) {
    const listEl = document.getElementById('me-interfaces-list');
    const countEl = document.getElementById('me-interfaces-count');
    if (!listEl) return;

    const ifaces = machine.interfaces || [];

    if (!ifaces.length) {
        listEl.innerHTML = '<span class="no-interfaces">Aucune interface détectée</span>';
        if (countEl) countEl.textContent = '';
        return;
    }

    if (countEl) countEl.textContent = ifaces.length + ' interface' + (ifaces.length > 1 ? 's' : '');

    listEl.innerHTML = ifaces.map(iface => {
        const isLoopback = iface.ipv4 === '127.0.0.1' || iface.name === 'lo';
        const rows = [];
        if (iface.ipv4) {
            rows.push(`
                <div class="iface-row">
                    <span class="iface-row-label">Adresse IPv4</span>
                    <span class="iface-row-value">${iface.ipv4}</span>
                </div>`);
        }
        if (iface.netmask) {
            rows.push(`
                <div class="iface-row">
                    <span class="iface-row-label">Masque sous-réseau</span>
                    <span class="iface-row-value">${iface.netmask}</span>
                </div>`);
        }
        if (iface.ipv6 && iface.ipv6.length) {
            iface.ipv6.forEach(ip6 => {
                rows.push(`
                <div class="iface-row">
                    <span class="iface-row-label">Adresse IPv6</span>
                    <span class="iface-row-value ipv6">${ip6}</span>
                </div>`);
            });
        }
        if (iface.mac) {
            rows.push(`
                <div class="iface-row">
                    <span class="iface-row-label">Adresse MAC</span>
                    <span class="iface-row-value mac">${iface.mac}</span>
                </div>`);
        }
        return `
            <div class="iface-block${isLoopback ? ' iface-loopback' : ''}">
                <div class="iface-block-header">
                    <span class="iface-dot"></span>
                    <span class="iface-block-name">${iface.name}</span>
                </div>
                <div class="iface-rows">${rows.join('')}</div>
            </div>`;
    }).join('');
}

function renderGlobalView() {
    const grid = document.getElementById('machines-grid');
    const emptyState = document.getElementById('emptyGlobal');
    const hint = document.getElementById('globalHint');
    const countEl = document.getElementById('machineCount');

    const count = allMachines.length;
    countEl.textContent = count + ' appareil' + (count !== 1 ? 's' : '');

    if (count === 0) {
        grid.innerHTML = '';
        grid.appendChild(hint);
        grid.appendChild(emptyState);
        hint.style.display = 'none';
        emptyState.style.display = '';
        return;
    }

    emptyState.style.display = 'none';
    hint.style.display = '';

    const sorted = [...allMachines].sort((a, b) => {
        if (a.machine_id === myMachineId) return -1;
        if (b.machine_id === myMachineId) return 1;
        return 0;
    });

    sorted.forEach(machine => {
        let card = document.querySelector(`.machine-card[data-machine-id="${machine.machine_id}"]`);
        if (!card) {
            card = createMachineCard(machine);
        } else {
            updateMachineCard(machine, card);
        }
        grid.appendChild(card);
    });

    document.querySelectorAll('.machine-card').forEach(card => {
        if (!allMachines.find(m => m.machine_id === card.dataset.machineId)) {
            card.remove();
        }
    });
}

function createMachineCard(machine) {
    const card = document.createElement('div');
    card.className = 'machine-card';
    card.dataset.machineId = machine.machine_id;
    card.title = 'Cliquer pour voir les détails';
    card.addEventListener('click', () => {
        showMachineModal(machine.machine_id);
    });
    updateMachineCard(machine, card);
    return card;
}

function updateMachineCard(machine, cardEl) {
    const card = cardEl || document.querySelector(`.machine-card[data-machine-id="${machine.machine_id}"]`);
    if (!card) return;

    const online = isOnline(machine);
    const cpu = machine.metrics?.cpu ?? 0;
    const ram = machine.metrics?.ram ?? 0;
    const ramUsed = machine.metrics?.ram_used_mb;
    const osDisplay = machine.os_display || machine.os_type || '—';
    const isMine = machine.machine_id === myMachineId;

    card.classList.toggle('is-mine', isMine);

    const elapsedSec = machine._lastSeenAt ? (Date.now() - machine._lastSeenAt) / 1000 : null;
    const lastSeenTxt = elapsedSec !== null ? formatLastSeen(elapsedSec) : '—';

    const uptimeSec = machine._uptimeBase != null && machine._uptimeAt
        ? machine._uptimeBase + (Date.now() - machine._uptimeAt) / 1000
        : null;
    const uptimeTxt = uptimeSec !== null ? formatUptime(uptimeSec) : '—';

    card.innerHTML = `
        ${isMine ? `<div class="my-machine-banner">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
            Votre machine
        </div>` : ''}
        <div class="card-top">
            <div>
                <div class="card-hostname">${machine.hostname || '—'}</div>
                <div class="card-os">${osDisplay}</div>
            </div>
            <span class="card-status ${online ? 'online' : 'offline'}">${online ? 'En ligne' : 'Hors ligne'}</span>
        </div>
        <div class="card-metrics">
            <div class="card-metric-item">
                <div class="card-metric-label">CPU</div>
                <div class="card-metric-value">${cpu.toFixed(1)}%</div>
                <div class="mini-bar"><div class="mini-fill cpu" style="width:${cpu}%"></div></div>
            </div>
            <div class="card-metric-item">
                <div class="card-metric-label">MÉMOIRE</div>
                <div class="card-metric-value">${ram.toFixed(1)}%</div>
                <div class="mini-bar"><div class="mini-fill ram" style="width:${ram}%"></div></div>
            </div>
        </div>
        <div class="card-footer">
            <span>RAM: ${ramUsed != null ? mbToDisplay(ramUsed) : '—'}</span>
            <span>Uptime: ${uptimeTxt}</span>
            <span>Vu ${lastSeenTxt}</span>
        </div>
    `;
}

function renderMyMachine() {
    const machine = myMachineId ? allMachines.find(m => m.machine_id === myMachineId) : null;
    const noAgent = document.getElementById('noAgentState');
    const machineData = document.getElementById('myMachineData');
    const statusBadge = document.getElementById('myMachineStatus');

    if (!machine) {
        machineData.style.display = 'none';
        statusBadge.textContent = 'Hors ligne';
        statusBadge.className = 'badge badge-offline';
        if (myMachineId && allMachines.length > 0) {
            // ID sauvegardé mais machine absente de la DB (DB réinitialisée) → reset
            localStorage.removeItem(STORAGE_KEY);
            myMachineId = null;
            if (noAgent) noAgent.style.display = '';
            _showNoAgentMain();
        }
        // Sinon : détection encore en cours, on ne touche pas au spinner
        return;
    }

    if (noAgent) noAgent.style.display = 'none';
    machineData.style.display = '';

    const online = isOnline(machine);
    statusBadge.textContent = online ? 'En ligne' : 'Hors ligne';
    statusBadge.className = 'badge ' + (online ? 'badge-online' : 'badge-offline');

    document.getElementById('me-hostname').textContent = machine.hostname || '—';
    document.getElementById('me-os').textContent = machine.os_display || machine.os_type || '—';
    document.getElementById('me-arch').textContent = machine.architecture || '—';
    document.getElementById('me-cores').textContent = machine.cpu_cores_logical || '—';

    const idEl = document.getElementById('me-machine-id');
    if (idEl) idEl.textContent = machine.machine_id;

    renderMyMachineInterfaces(machine);
    if (!machine.ip_addresses?.length) fetchMyMachineIp();

    tickMyMachine(machine);
    renderMyMachineMetrics(machine);
    requestAnimationFrame(() => initMeChart());
}

function tickMyMachine(machine) {
    if (!machine) return;

    const elapsedSec = machine._lastSeenAt ? (Date.now() - machine._lastSeenAt) / 1000 : null;
    const uptimeSec = machine._uptimeBase != null && machine._uptimeAt
        ? machine._uptimeBase + (Date.now() - machine._uptimeAt) / 1000
        : null;

    const uptimeEl = document.getElementById('me-uptime');
    const lastSeenEl = document.getElementById('me-lastseen');
    const statusBadge = document.getElementById('myMachineStatus');

    if (uptimeEl && uptimeSec !== null) uptimeEl.textContent = formatUptime(uptimeSec);
    if (lastSeenEl && elapsedSec !== null) lastSeenEl.textContent = formatLastSeen(elapsedSec);

    if (statusBadge) {
        const online = isOnline(machine);
        statusBadge.textContent = online ? 'En ligne' : 'Hors ligne';
        statusBadge.className = 'badge ' + (online ? 'badge-online' : 'badge-offline');
    }
}

function renderMyMachineMetrics(machine) {
    const m = machine.metrics || {};
    const cpu = m.cpu ?? 0;
    const ram = m.ram ?? 0;

    document.getElementById('me-cpu-val').textContent = cpu.toFixed(1) + '%';
    document.getElementById('me-cpu-bar').style.width = cpu + '%';
    document.getElementById('me-cpu-model').textContent = machine.cpu_model || '—';
    document.getElementById('me-cpu-cores').textContent = machine.cpu_cores_logical ? machine.cpu_cores_logical + ' cœurs' : '—';

    document.getElementById('me-ram-val').textContent = ram.toFixed(1) + '%';
    document.getElementById('me-ram-bar').style.width = ram + '%';
    document.getElementById('me-ram-used').textContent = mbToDisplay(m.ram_used_mb);
    document.getElementById('me-ram-total').textContent = mbToDisplay(m.ram_total_mb);
    document.getElementById('me-ram-free').textContent = mbToDisplay(m.ram_free_mb);

    document.getElementById('me-net-recv').textContent = mbToDisplay(m.network_recv_mb);
    document.getElementById('me-net-sent').textContent = mbToDisplay(m.network_sent_mb);

    const disksEl = document.getElementById('me-disks');
    const disks = m.disks || [];
    if (disks.length === 0) {
        disksEl.innerHTML = '<span style="color:var(--text2);font-size:12px;">Aucun disque détecté</span>';
    } else {
        disksEl.innerHTML = disks.map(d => {
            const pct = d.percent || 0;
            const cls = pct > 85 ? 'danger' : pct > 65 ? 'warn' : '';
            const label = d.device || d.mountpoint || '?';
            const usedGb = typeof d.used_gb === 'number' ? d.used_gb.toFixed(2) : '?';
            const totalGb = typeof d.total_gb === 'number' ? d.total_gb.toFixed(2) : '?';
            return `
                <div class="disk-item">
                    <div class="disk-header">
                        <span class="disk-name">${label}</span>
                        <span class="disk-info">${usedGb} GB / ${totalGb} GB (${pct.toFixed(1)}%)</span>
                    </div>
                    <div class="disk-bar"><div class="disk-fill ${cls}" style="width:${pct}%"></div></div>
                </div>
            `;
        }).join('');
    }
}

function showMachineModal(machineId) {
    const machine = allMachines.find(m => m.machine_id === machineId);
    if (!machine) return;

    currentModalMachineId = machineId;
    fillMachineModal(machine);
    document.getElementById('machineModal').classList.add('open');
    requestAnimationFrame(() => initModalChart(machineId));
}

function fillMachineModal(machine) {
    const m = machine.metrics || {};
    const online = isOnline(machine);
    const cpu = m.cpu ?? 0;
    const ram = m.ram ?? 0;
    const isMine = machine.machine_id === myMachineId;

    const elapsedSec = machine._lastSeenAt ? (Date.now() - machine._lastSeenAt) / 1000 : null;
    const uptimeSec = machine._uptimeBase != null && machine._uptimeAt
        ? machine._uptimeBase + (Date.now() - machine._uptimeAt) / 1000
        : null;

    document.getElementById('mm-hostname').textContent = machine.hostname || '—';
    const statusEl = document.getElementById('mm-status');
    statusEl.textContent = online ? 'En ligne' : 'Hors ligne';
    statusEl.className = 'card-status ' + (online ? 'online' : 'offline');

    document.getElementById('mm-os').textContent = machine.os_display || machine.os_type || '—';
    document.getElementById('mm-arch').textContent = machine.architecture || '—';
    document.getElementById('mm-cpu-model').textContent = machine.cpu_model || '—';
    document.getElementById('mm-cores').textContent = machine.cpu_cores_logical ? machine.cpu_cores_logical + ' cœurs' : '—';
    document.getElementById('mm-uptime').textContent = uptimeSec !== null ? formatUptime(uptimeSec) : '—';
    document.getElementById('mm-lastseen').textContent = elapsedSec !== null ? formatLastSeen(elapsedSec) : '—';

    document.getElementById('mm-cpu-val').textContent = cpu.toFixed(1) + '%';
    document.getElementById('mm-cpu-bar').style.width = cpu + '%';
    document.getElementById('mm-ram-val').textContent = ram.toFixed(1) + '%';
    document.getElementById('mm-ram-bar').style.width = ram + '%';
    document.getElementById('mm-ram-used').textContent = mbToDisplay(m.ram_used_mb);
    document.getElementById('mm-ram-total').textContent = mbToDisplay(m.ram_total_mb);
    document.getElementById('mm-ram-free').textContent = mbToDisplay(m.ram_free_mb);
    document.getElementById('mm-net-recv').textContent = mbToDisplay(m.network_recv_mb);
    document.getElementById('mm-net-sent').textContent = mbToDisplay(m.network_sent_mb);

    const disksEl = document.getElementById('mm-disks');
    const disks = m.disks || [];
    if (disks.length === 0) {
        disksEl.innerHTML = '<span style="color:var(--text2);font-size:12px;">Aucun disque détecté</span>';
    } else {
        disksEl.innerHTML = disks.map(d => {
            const pct = d.percent || 0;
            const cls = pct > 85 ? 'danger' : pct > 65 ? 'warn' : '';
            const label = d.device || d.mountpoint || '?';
            const usedGb = typeof d.used_gb === 'number' ? d.used_gb.toFixed(2) : '?';
            const totalGb = typeof d.total_gb === 'number' ? d.total_gb.toFixed(2) : '?';
            return `<div class="disk-item">
                <div class="disk-header">
                    <span class="disk-name">${label}</span>
                    <span class="disk-info">${usedGb} GB / ${totalGb} GB (${pct.toFixed(1)}%)</span>
                </div>
                <div class="disk-bar"><div class="disk-fill ${cls}" style="width:${pct}%"></div></div>
            </div>`;
        }).join('');
    }

}

function closeMachineModal() {
    document.getElementById('machineModal').classList.remove('open');
    currentModalMachineId = null;
    if (modalChart) { modalChart.destroy(); modalChart = null; }
}

function _applyIdentifiedMachine(machineId) {
    myMachineId = machineId;
    fetchMyMachineIp();
    renderGlobalView();
    const currentView = document.querySelector('.view.active')?.id;
    if (currentView === 'view-me') renderMyMachine();
}

function _showNoAgentMain() {
    const detecting = document.getElementById('noAgentDetecting');
    const main = document.getElementById('noAgentMain');
    if (detecting) detecting.style.display = 'none';
    if (main) main.style.display = '';
}

async function getLocalIpViaWebRTC() {
    return new Promise((resolve) => {
        try {
            const pc = new RTCPeerConnection({ iceServers: [] });
            const ips = new Set();
            pc.createDataChannel('');
            pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => resolve(null));
            pc.onicecandidate = (ice) => {
                if (!ice || !ice.candidate || !ice.candidate.candidate) {
                    pc.close();
                    const found = [...ips].find(ip => !ip.startsWith('127.') && !ip.startsWith('169.254.'));
                    resolve(found || null);
                    return;
                }
                const m = ice.candidate.candidate.match(/\b(\d{1,3}(\.\d{1,3}){3})\b/);
                if (m) ips.add(m[1]);
            };
            setTimeout(() => {
                pc.close();
                const found = [...ips].find(ip => !ip.startsWith('127.') && !ip.startsWith('169.254.'));
                resolve(found || null);
            }, 2500);
        } catch(e) {
            resolve(null);
        }
    });
}

async function autoIdentifyMyMachine() {
    // Étape 1 : Cookie persistant (méthode principale)
    // Le serveur vérifie le cookie l2ig2_machine posé lors de l'enregistrement du navigateur
    try {
        const res = await fetch('/api/identify');
        const data = await res.json();
        if (data.machine_id) {
            _applyIdentifiedMachine(data.machine_id);
            return;
        }
    } catch(e) {}

    // Étape 2 : WebRTC — même réseau que l'agent (avant enregistrement du navigateur)
    let localIp = null;
    try { localIp = await getLocalIpViaWebRTC(); } catch(e) {}

    if (localIp) {
        try {
            const res = await fetch(`/api/identify?localIp=${encodeURIComponent(localIp)}`);
            const data = await res.json();
            if (data.machine_id) {
                _applyIdentifiedMachine(data.machine_id);
                return;
            }
        } catch(e) {}
    }

    // Étape 3 : Aucune machine trouvée → écran de téléchargement
    _showNoAgentMain();
}

function showGuide(os) {
    const modal = document.getElementById('guideModal');
    const title = document.getElementById('guideTitle');
    const content = document.getElementById('guideContent');
    document.querySelector('.download-wrapper').classList.remove('open');

    const guides = {
        windows: {
            title: 'Windows — Notice d\'emploi',
            html: `
                <div style="margin-bottom:16px;">
                    <a href="/api/download/windows" download="node-monitor-agent.exe" class="guide-download-btn">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Télécharger node-monitor-agent.exe
                    </a>
                </div>
                <h3>1. Lancer l'agent</h3>
                <p>Double-cliquez sur <code>node-monitor-agent.exe</code>. Une fenêtre s'ouvre automatiquement.</p>
                <h3>2. Connexion au serveur</h3>
                <p>Au premier lancement, entrez l'adresse du serveur dans le champ prévu. Si l'URL est déjà pré-remplie, cliquez simplement sur <strong>Se reconnecter</strong>.</p>
                <p>L'adresse du serveur est mémorisée automatiquement pour les prochains lancements.</p>
                <h3>3. État de l'agent</h3>
                <p>Une fois connecté, la fenêtre affiche :</p>
                <ul>
                    <li>✓ <strong>Connecté</strong> — les métriques sont envoyées à la fréquence choisie sur le tableau de bord</li>
                    <li>Nom de la machine et identifiant unique</li>
                    <li>Heure du dernier envoi et compteur total</li>
                </ul>
                <h3>4. Fonctionnement en arrière-plan</h3>
                <p>Fermez la fenêtre → l'agent se <strong>réduit dans la barre des tâches</strong> et continue à envoyer les métriques.</p>
                <p>Cliquez sur <strong>Arrêter la connexion</strong> pour mettre en pause, puis <strong>Relancer</strong> pour reprendre.</p>
                <h3>5. Changer de serveur</h3>
                <p>Cliquez sur <strong>Changer de serveur</strong> depuis l'écran arrêté pour saisir une nouvelle adresse.</p>
                <h3>6. Note Windows Defender</h3>
                <p>Si Windows affiche un avertissement SmartScreen, cliquez sur <strong>Informations complémentaires → Exécuter quand même</strong>.</p>
            `
        },
        'linux-debian': {
            title: 'Linux — Debian / Ubuntu / Mint',
            html: `
                <div style="margin-bottom:16px;">
                    <a href="/api/download/linux/debian" download="install-linux-debian.sh" class="guide-download-btn">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Télécharger install-linux-debian.sh
                    </a>
                </div>
                <div style="background:#0d2137;border:1px solid #1e4a6e;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;">
                    📁 <strong>Dossier d'installation :</strong> <code style="color:#4f8ef7">~/l2ig2-monitor/</code><br>
                    <span style="color:#6b7280;font-size:11px;">Retrouvez ce dossier directement dans votre répertoire personnel (Home).</span>
                </div>
                <h3>1. Rendre le script exécutable et le lancer</h3>
                <pre>chmod +x install-linux-debian.sh
./install-linux-debian.sh</pre>
                <p>Le script installe automatiquement Python 3, pip et <code>psutil</code> via <strong>apt</strong>, puis télécharge l'agent.</p>
                <h3>2. Ce que fait l'installateur</h3>
                <ul>
                    <li>Installe <code>python3</code>, <code>python3-pip</code> si absents (<code>apt-get</code>)</li>
                    <li>Installe <code>psutil</code> (pip ou paquet <code>python3-psutil</code>)</li>
                    <li>Télécharge <code>agent.py</code> dans <code>~/l2ig2-monitor/</code></li>
                    <li>Crée le script de lancement <code>l2ig2-monitor-agent.sh</code></li>
                    <li>Propose l'installation comme <strong>service systemd</strong> (démarrage automatique)</li>
                </ul>
                <h3>3. Lancer l'agent manuellement</h3>
                <pre>bash ~/l2ig2-monitor/l2ig2-monitor-agent.sh</pre>
                <h3>4. Service systemd (démarrage automatique)</h3>
                <p>Répondez <strong>o</strong> à la question du script pour activer le démarrage au boot.</p>
                <pre>sudo systemctl status l2ig2-monitor-agent
sudo systemctl stop l2ig2-monitor-agent
sudo journalctl -u l2ig2-monitor-agent -f</pre>
                <h3>5. Désinstaller</h3>
                <pre>sudo systemctl stop l2ig2-monitor-agent
sudo systemctl disable l2ig2-monitor-agent
rm -rf ~/l2ig2-monitor</pre>
            `
        },
        'linux-fedora': {
            title: 'Linux — Fedora / RHEL / CentOS / Rocky',
            html: `
                <div style="margin-bottom:16px;">
                    <a href="/api/download/linux/fedora" download="install-linux-fedora.sh" class="guide-download-btn">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Télécharger install-linux-fedora.sh
                    </a>
                </div>
                <div style="background:#0d2137;border:1px solid #1e4a6e;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;">
                    📁 <strong>Dossier d'installation :</strong> <code style="color:#4f8ef7">~/l2ig2-monitor/</code><br>
                    <span style="color:#6b7280;font-size:11px;">Retrouvez ce dossier directement dans votre répertoire personnel (Home).</span>
                </div>
                <h3>1. Rendre le script exécutable et le lancer</h3>
                <pre>chmod +x install-linux-fedora.sh
./install-linux-fedora.sh</pre>
                <p>Le script installe automatiquement Python 3, pip et <code>psutil</code> via <strong>dnf</strong> (ou <strong>yum</strong> sur les systèmes plus anciens).</p>
                <h3>2. Ce que fait l'installateur</h3>
                <ul>
                    <li>Détecte automatiquement <code>dnf</code> ou <code>yum</code></li>
                    <li>Installe <code>python3</code>, <code>python3-pip</code> si absents</li>
                    <li>Installe <code>psutil</code> (pip ou paquet <code>python3-psutil</code>)</li>
                    <li>Télécharge <code>agent.py</code> dans <code>~/l2ig2-monitor/</code></li>
                    <li>Crée le script de lancement <code>l2ig2-monitor-agent.sh</code></li>
                    <li>Propose l'installation comme <strong>service systemd</strong></li>
                </ul>
                <h3>3. Lancer l'agent manuellement</h3>
                <pre>bash ~/l2ig2-monitor/l2ig2-monitor-agent.sh</pre>
                <h3>4. Service systemd (démarrage automatique)</h3>
                <pre>sudo systemctl status l2ig2-monitor-agent
sudo systemctl stop l2ig2-monitor-agent
sudo journalctl -u l2ig2-monitor-agent -f</pre>
                <h3>5. Note SELinux (RHEL/CentOS)</h3>
                <p>Si SELinux bloque l'exécution du service, lancez l'agent en mode CLI directement plutôt qu'en service systemd.</p>
            `
        },
        'linux-arch': {
            title: 'Linux — Arch / Manjaro / EndeavourOS',
            html: `
                <div style="margin-bottom:16px;">
                    <a href="/api/download/linux/arch" download="install-linux-arch.sh" class="guide-download-btn">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Télécharger install-linux-arch.sh
                    </a>
                </div>
                <div style="background:#0d2137;border:1px solid #1e4a6e;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;">
                    📁 <strong>Dossier d'installation :</strong> <code style="color:#4f8ef7">~/l2ig2-monitor/</code><br>
                    <span style="color:#6b7280;font-size:11px;">Retrouvez ce dossier directement dans votre répertoire personnel (Home).</span>
                </div>
                <h3>1. Rendre le script exécutable et le lancer</h3>
                <pre>chmod +x install-linux-arch.sh
./install-linux-arch.sh</pre>
                <p>Le script installe les dépendances via <strong>pacman</strong> et télécharge l'agent.</p>
                <h3>2. Ce que fait l'installateur</h3>
                <ul>
                    <li>Installe <code>python</code> si absent (<code>pacman -S python</code>)</li>
                    <li>Installe <code>python-psutil</code> (dépôts Arch ou pip)</li>
                    <li>Télécharge <code>agent.py</code> dans <code>~/l2ig2-monitor/</code></li>
                    <li>Crée le script de lancement <code>l2ig2-monitor-agent.sh</code></li>
                    <li>Propose l'installation comme <strong>service systemd</strong></li>
                </ul>
                <h3>3. Lancer l'agent manuellement</h3>
                <pre>bash ~/l2ig2-monitor/l2ig2-monitor-agent.sh</pre>
                <h3>4. Service systemd (démarrage automatique)</h3>
                <pre>sudo systemctl status l2ig2-monitor-agent
sudo systemctl stop l2ig2-monitor-agent
sudo journalctl -u l2ig2-monitor-agent -f</pre>
                <h3>5. Note pip sur Arch</h3>
                <p>Arch déconseille l'utilisation de pip en dehors d'un environnement virtuel. Si pip échoue, le script utilise automatiquement <code>sudo pacman -S python-psutil</code>.</p>
            `
        },
        'linux-opensuse': {
            title: 'Linux — openSUSE Leap / Tumbleweed',
            html: `
                <div style="margin-bottom:16px;">
                    <a href="/api/download/linux/opensuse" download="install-linux-opensuse.sh" class="guide-download-btn">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Télécharger install-linux-opensuse.sh
                    </a>
                </div>
                <div style="background:#0d2137;border:1px solid #1e4a6e;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;">
                    📁 <strong>Dossier d'installation :</strong> <code style="color:#4f8ef7">~/l2ig2-monitor/</code><br>
                    <span style="color:#6b7280;font-size:11px;">Retrouvez ce dossier directement dans votre répertoire personnel (Home).</span>
                </div>
                <h3>1. Rendre le script exécutable et le lancer</h3>
                <pre>chmod +x install-linux-opensuse.sh
./install-linux-opensuse.sh</pre>
                <p>Le script installe les dépendances via <strong>zypper</strong> et télécharge l'agent.</p>
                <h3>2. Ce que fait l'installateur</h3>
                <ul>
                    <li>Installe <code>python3</code>, <code>python3-pip</code> si absents (<code>zypper</code>)</li>
                    <li>Installe <code>psutil</code> (pip ou paquet <code>python3-psutil</code>)</li>
                    <li>Télécharge <code>agent.py</code> dans <code>~/l2ig2-monitor/</code></li>
                    <li>Crée le script de lancement <code>l2ig2-monitor-agent.sh</code></li>
                    <li>Propose l'installation comme <strong>service systemd</strong></li>
                </ul>
                <h3>3. Lancer l'agent manuellement</h3>
                <pre>bash ~/l2ig2-monitor/l2ig2-monitor-agent.sh</pre>
                <h3>4. Service systemd (démarrage automatique)</h3>
                <pre>sudo systemctl status l2ig2-monitor-agent
sudo systemctl stop l2ig2-monitor-agent
sudo journalctl -u l2ig2-monitor-agent -f</pre>
            `
        },
        macos: {
            title: 'Guide — macOS',
            html: `
                <h3>1. Prérequis</h3>
                <pre>brew install python3
pip3 install psutil pyinstaller</pre>
                <h3>2. Télécharger l'agent</h3>
                <p>Cliquez sur <strong>agent.py (tous systèmes)</strong> dans le menu.</p>
                <h3>3. Compiler</h3>
                <pre>pyinstaller --onefile --name node-monitor-agent agent.py</pre>
                <h3>4. Lancer</h3>
                <pre>chmod +x dist/node-monitor-agent
./dist/node-monitor-agent</pre>
                <p>Au premier lancement, entrez l'adresse du serveur. Elle est sauvegardée dans <code>agent_config.json</code>.</p>
                <h3>5. Note macOS</h3>
                <p>Si macOS bloque l'exécution : <strong>Réglages Système → Sécurité → Autoriser quand même</strong>.</p>
            `
        }
    };

    const guide = guides[os];
    if (!guide) return;
    title.textContent = guide.title;
    content.innerHTML = guide.html;
    modal.classList.add('open');
}

function closeGuide() {
    document.getElementById('guideModal').classList.remove('open');
}

setInterval(() => {
    allMachines.forEach(machine => {
        updateMachineCard(machine);
    });

    const currentView = document.querySelector('.view.active')?.id;
    if (currentView === 'view-me' && myMachineId) {
        const machine = allMachines.find(m => m.machine_id === myMachineId);
        if (machine) tickMyMachine(machine);
    }

    if (currentModalMachineId) {
        const machine = allMachines.find(m => m.machine_id === currentModalMachineId);
        if (machine) {
            const elapsedSec = machine._lastSeenAt ? (Date.now() - machine._lastSeenAt) / 1000 : null;
            const uptimeSec = machine._uptimeBase != null && machine._uptimeAt
                ? machine._uptimeBase + (Date.now() - machine._uptimeAt) / 1000
                : null;
            if (uptimeSec !== null) document.getElementById('mm-uptime').textContent = formatUptime(uptimeSec);
            if (elapsedSec !== null) document.getElementById('mm-lastseen').textContent = formatLastSeen(elapsedSec);
            const online = isOnline(machine);
            const statusEl = document.getElementById('mm-status');
            if (statusEl) {
                statusEl.textContent = online ? 'En ligne' : 'Hors ligne';
                statusEl.className = 'card-status ' + (online ? 'online' : 'offline');
            }
        }
    }
}, 1000);

// ── Communication inter-onglets ──────────────────────────────
// Quand le navigateur ouvre le lien d'enregistrement dans un nouvel onglet,
// les autres onglets du dashboard sont notifiés via BroadcastChannel
// et relancent l'identification immédiatement.
let _bc = null;
try {
    _bc = new BroadcastChannel('l2ig2_identify');
    _bc.onmessage = (ev) => {
        if (ev.data?.type === 'registered') autoIdentifyMyMachine();
    };
} catch(e) {}

// Si l'agent vient d'enregistrer ce navigateur, naviguer vers "Ma Machine"
if (new URLSearchParams(window.location.search).get('registered') === '1') {
    history.replaceState(null, '', window.location.pathname);
    // Notifier tous les autres onglets ouverts sur ce dashboard
    try { if (_bc) _bc.postMessage({ type: 'registered' }); } catch(e) {}
    // Forcer la ré-identification immédiate dans cet onglet aussi
    autoIdentifyMyMachine().then(() => switchView('me'));
}

setInterval(fetchMachines, 15000);
fetchMachines();
autoIdentifyMyMachine();
setInterval(autoIdentifyMyMachine, 30000);
loadCurrentInterval();
