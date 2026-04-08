const socket = io();
let allMachines = [];
let myMachineId = localStorage.getItem('myMachineId') || null;

const ONLINE_THRESHOLD_MS = 30000;

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

        if (machine.machine_id === myMachineId && data.ip_address) {
            machine.ip_address = data.ip_address;
        }

        updateMachineCard(machine);
        if (machine.machine_id === myMachineId) renderMyMachineMetrics(machine);
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
        if (machine && detail.ip_address) {
            machine.ip_address = detail.ip_address;
            const ipEl = document.getElementById('me-ip');
            if (ipEl) ipEl.textContent = detail.ip_address;
        }
    } catch(e) {}
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
    hint.style.display = !myMachineId ? '' : 'none';

    allMachines.forEach(machine => {
        let card = document.querySelector(`.machine-card[data-machine-id="${machine.machine_id}"]`);
        if (!card) {
            card = createMachineCard(machine);
            grid.appendChild(card);
        } else {
            updateMachineCard(machine, card);
        }
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
    card.title = 'Cliquer pour définir comme Ma Machine';
    card.addEventListener('click', () => {
        myMachineId = machine.machine_id;
        localStorage.setItem('myMachineId', myMachineId);
        fetchMyMachineIp();
        switchView('me');
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

    const elapsedSec = machine._lastSeenAt ? (Date.now() - machine._lastSeenAt) / 1000 : null;
    const lastSeenTxt = elapsedSec !== null ? formatLastSeen(elapsedSec) : '—';

    const uptimeSec = machine._uptimeBase != null && machine._uptimeAt
        ? machine._uptimeBase + (Date.now() - machine._uptimeAt) / 1000
        : null;
    const uptimeTxt = uptimeSec !== null ? formatUptime(uptimeSec) : '—';

    card.innerHTML = `
        <div class="card-top">
            <div>
                <div class="card-hostname">${machine.hostname || '—'}${isMine ? ' <span class="mine-badge">moi</span>' : ''}</div>
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
        noAgent.style.display = '';
        machineData.style.display = 'none';
        statusBadge.textContent = 'Hors ligne';
        statusBadge.className = 'badge badge-offline';
        return;
    }

    noAgent.style.display = 'none';
    machineData.style.display = '';

    const online = isOnline(machine);
    statusBadge.textContent = online ? 'En ligne' : 'Hors ligne';
    statusBadge.className = 'badge ' + (online ? 'badge-online' : 'badge-offline');

    document.getElementById('me-hostname').textContent = machine.hostname || '—';
    document.getElementById('me-os').textContent = machine.os_display || machine.os_type || '—';
    document.getElementById('me-arch').textContent = machine.architecture || '—';
    document.getElementById('me-cores').textContent = machine.cpu_cores_logical || '—';
    document.getElementById('me-ip').textContent = machine.ip_address || '—';

    if (!machine.ip_address) fetchMyMachineIp();

    tickMyMachine(machine);
    renderMyMachineMetrics(machine);
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

function showGuide(os) {
    const modal = document.getElementById('guideModal');
    const title = document.getElementById('guideTitle');
    const content = document.getElementById('guideContent');
    document.querySelector('.download-wrapper').classList.remove('open');

    const guides = {
        windows: {
            title: 'Guide — Windows .exe',
            html: `
                <h3>1. Prérequis</h3>
                <p>Installez <a href="https://python.org" target="_blank">Python 3.10+</a> (cochez "Add Python to PATH") puis :</p>
                <pre>pip install psutil pyinstaller</pre>
                <h3>2. Télécharger l'agent</h3>
                <p>Cliquez sur <strong>agent.py (tous systèmes)</strong> dans le menu ci-dessus pour télécharger le fichier.</p>
                <h3>3. Compiler en .exe</h3>
                <pre>pyinstaller --onefile --noconsole --name node-monitor-agent agent.py</pre>
                <p>L'exécutable se trouve dans <code>dist\\node-monitor-agent.exe</code></p>
                <h3>4. Lancer</h3>
                <pre>dist\\node-monitor-agent.exe</pre>
                <p>Au premier lancement, une fenêtre vous demande l'adresse du serveur. L'URL est ensuite sauvegardée dans <code>agent_config.json</code> pour les prochains démarrages.</p>
            `
        },
        linux: {
            title: 'Guide — Linux binaire',
            html: `
                <h3>1. Prérequis</h3>
                <pre>sudo apt update && sudo apt install python3 python3-pip -y
pip3 install psutil pyinstaller</pre>
                <h3>2. Télécharger l'agent</h3>
                <p>Cliquez sur <strong>agent.py (tous systèmes)</strong> dans le menu ci-dessus.</p>
                <h3>3. Compiler en binaire</h3>
                <pre>pyinstaller --onefile --name node-monitor-agent agent.py</pre>
                <p>Le binaire se trouve dans <code>dist/node-monitor-agent</code></p>
                <h3>4. Lancer</h3>
                <pre>chmod +x dist/node-monitor-agent
./dist/node-monitor-agent</pre>
                <p>Au premier lancement, entrez l'adresse du serveur dans le terminal. Elle est sauvegardée dans <code>agent_config.json</code>.</p>
                <h3>5. Démarrage automatique (optionnel)</h3>
                <pre>sudo cp dist/node-monitor-agent /usr/local/bin/
sudo chmod +x /usr/local/bin/node-monitor-agent</pre>
            `
        },
        macos: {
            title: 'Guide — macOS binaire',
            html: `
                <h3>1. Prérequis</h3>
                <pre>brew install python3
pip3 install psutil pyinstaller</pre>
                <h3>2. Télécharger l'agent</h3>
                <p>Cliquez sur <strong>agent.py (tous systèmes)</strong> dans le menu ci-dessus.</p>
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
    const now = Date.now();

    allMachines.forEach(machine => {
        updateMachineCard(machine);
    });

    const currentView = document.querySelector('.view.active')?.id;
    if (currentView === 'view-me' && myMachineId) {
        const machine = allMachines.find(m => m.machine_id === myMachineId);
        if (machine) tickMyMachine(machine);
    }
}, 1000);

setInterval(fetchMachines, 15000);
fetchMachines();
