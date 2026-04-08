const socket = io();
let allMachines = [];
let myMachineId = localStorage.getItem('myMachineId') || null;
let myIp = null;

function mbToDisplay(mb) {
    if (!mb && mb !== 0) return '—';
    if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
    return mb.toFixed(0) + ' MB';
}

function switchView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    document.querySelector(`[data-view="${view}"]`).classList.add('active');
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

socket.on('machine_connected', () => { fetchMachines(); });
socket.on('machine_disconnected', () => { fetchMachines(); });

socket.on('metrics_update', (data) => {
    const machine = allMachines.find(m => m.machine_id === data.machine_id);
    if (machine) {
        machine.metrics = {
            cpu: data.metrics.cpu_percent,
            ram: data.metrics.ram_percent,
            ram_used_mb: data.metrics.ram_used_mb,
            ram_total_mb: data.metrics.ram_total_mb,
            ram_free_mb: data.metrics.ram_free_mb,
            network_sent_mb: data.metrics.network_sent_mb,
            network_recv_mb: data.metrics.network_recv_mb,
            uptime_display: data.metrics.uptime_display,
            disks: data.metrics.disks || [],
            gpu: data.metrics.gpu_percent
        };
        machine.last_seen_display = 'À l\'instant';
        updateMachineCard(machine);
        if (machine.machine_id === myMachineId) {
            renderMyMachineMetrics(machine);
        }
    }
});

async function detectMyMachine(machines) {
    if (myMachineId && machines.find(m => m.machine_id === myMachineId)) return;

    try {
        if (!myIp) {
            const res = await fetch('/api/my-ip');
            const data = await res.json();
            myIp = data.ip;
        }
        if (myIp) {
            const match = machines.find(m => m.ip_address === myIp || m.ip === myIp);
            if (match) {
                myMachineId = match.machine_id;
                localStorage.setItem('myMachineId', myMachineId);
            }
        }
    } catch(e) {}
}

async function fetchMachines() {
    try {
        const res = await fetch('/api/machines');
        allMachines = await res.json();

        await detectMyMachine(allMachines);

        renderGlobalView();

        const currentView = document.querySelector('.view.active')?.id;
        if (currentView === 'view-me') renderMyMachine();
    } catch(e) {
        console.error('Error fetching machines:', e);
    }
}

function renderGlobalView() {
    const grid = document.getElementById('machines-grid');
    const emptyState = document.getElementById('emptyGlobal');
    const countEl = document.getElementById('machineCount');

    const count = allMachines.length;
    countEl.textContent = count + ' appareil' + (count !== 1 ? 's' : '');

    if (count === 0) {
        grid.innerHTML = '';
        grid.appendChild(emptyState);
        emptyState.style.display = '';
        return;
    }

    emptyState.style.display = 'none';

    allMachines.forEach(machine => {
        let card = document.querySelector(`[data-machine-id="${machine.machine_id}"]`);
        if (!card) {
            card = createMachineCard(machine);
            grid.appendChild(card);
        } else {
            updateMachineCard(machine);
        }
    });

    document.querySelectorAll('.machine-card').forEach(card => {
        const id = card.dataset.machineId;
        if (!allMachines.find(m => m.machine_id === id)) {
            card.remove();
        }
    });
}

function createMachineCard(machine) {
    const card = document.createElement('div');
    card.className = 'machine-card';
    card.dataset.machineId = machine.machine_id;
    card.addEventListener('click', () => {
        myMachineId = machine.machine_id;
        localStorage.setItem('myMachineId', myMachineId);
        switchView('me');
    });
    updateMachineCard(machine, card);
    return card;
}

function updateMachineCard(machine, cardEl) {
    const card = cardEl || document.querySelector(`[data-machine-id="${machine.machine_id}"]`);
    if (!card) return;

    const now = Date.now();
    const lastSeen = new Date(machine.last_seen + ' UTC').getTime();
    const diffSec = (now - lastSeen) / 1000;
    const isOnline = diffSec < 30;

    const cpu = machine.metrics?.cpu ?? 0;
    const ram = machine.metrics?.ram ?? 0;
    const ramUsed = machine.metrics?.ram_used_mb;
    const uptime = machine.metrics?.uptime_display || '—';
    const lastSeenDisplay = machine.last_seen_display || machine.last_seen || '—';

    const osDisplay = machine.os_display || machine.os_type || '—';

    card.innerHTML = `
        <div class="card-top">
            <div>
                <div class="card-hostname">${machine.hostname || '—'}</div>
                <div class="card-os">${osDisplay}</div>
            </div>
            <span class="card-status ${isOnline ? 'online' : 'offline'}">${isOnline ? 'En ligne' : 'Hors ligne'}</span>
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
            <span>RAM: ${ramUsed ? mbToDisplay(ramUsed) : '—'}</span>
            <span>Uptime: ${uptime}</span>
            <span>Vu ${lastSeenDisplay}</span>
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

    const now = Date.now();
    const lastSeen = new Date(machine.last_seen + ' UTC').getTime();
    const diffSec = (now - lastSeen) / 1000;
    const isOnline = diffSec < 30;

    statusBadge.textContent = isOnline ? 'En ligne' : 'Hors ligne';
    statusBadge.className = 'badge ' + (isOnline ? 'badge-online' : 'badge-offline');

    document.getElementById('me-hostname').textContent = machine.hostname || '—';
    document.getElementById('me-os').textContent = machine.os_display || machine.os_type || '—';
    document.getElementById('me-arch').textContent = machine.architecture || '—';
    document.getElementById('me-cores').textContent = machine.cpu_cores_logical || '—';
    document.getElementById('me-uptime').textContent = machine.metrics?.uptime_display || '—';
    document.getElementById('me-lastseen').textContent = machine.last_seen_display || machine.last_seen || '—';

    renderMyMachineMetrics(machine);
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
            return `
                <div class="disk-item">
                    <div class="disk-header">
                        <span class="disk-name">${label}</span>
                        <span class="disk-info">${d.used_gb.toFixed(2)} GB / ${d.total_gb.toFixed(2)} GB (${pct.toFixed(1)}%)</span>
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
                <p>Installez Python 3.10+ depuis <a href="https://python.org" target="_blank">python.org</a> (cochez "Add Python to PATH").</p>
                <h3>2. Télécharger l'agent</h3>
                <p>Téléchargez agent.py et requirements.txt :</p>
                <pre>pip install -r requirements.txt
pip install pyinstaller</pre>
                <h3>3. Compiler en .exe</h3>
                <pre>pyinstaller --onefile --noconsole agent.py</pre>
                <p>L'exécutable sera dans <code>dist/agent.exe</code></p>
                <h3>4. Configurer le serveur</h3>
                <p>Modifiez <code>config_agent.py</code> et définissez <code>SERVER_URL</code> avec l'adresse de votre serveur.</p>
                <h3>5. Lancer</h3>
                <pre>dist\\agent.exe</pre>
            `
        },
        linux: {
            title: 'Guide — Linux binaire',
            html: `
                <h3>1. Prérequis</h3>
                <pre>sudo apt update && sudo apt install python3 python3-pip -y</pre>
                <h3>2. Installer les dépendances</h3>
                <pre>pip3 install -r requirements.txt
pip3 install pyinstaller</pre>
                <h3>3. Compiler en binaire</h3>
                <pre>pyinstaller --onefile agent.py</pre>
                <p>Le binaire sera dans <code>dist/agent</code></p>
                <h3>4. Configurer le serveur</h3>
                <p>Modifiez <code>config_agent.py</code> et définissez <code>SERVER_URL</code> avec l'adresse de votre serveur.</p>
                <h3>5. Lancer</h3>
                <pre>chmod +x dist/agent
./dist/agent</pre>
                <h3>6. (Optionnel) Lancement automatique</h3>
                <pre>sudo cp dist/agent /usr/local/bin/node-monitor-agent
sudo chmod +x /usr/local/bin/node-monitor-agent</pre>
            `
        },
        macos: {
            title: 'Guide — macOS binaire',
            html: `
                <h3>1. Prérequis</h3>
                <p>Installez Python 3 via Homebrew :</p>
                <pre>brew install python3</pre>
                <h3>2. Installer les dépendances</h3>
                <pre>pip3 install -r requirements.txt
pip3 install pyinstaller</pre>
                <h3>3. Compiler</h3>
                <pre>pyinstaller --onefile agent.py</pre>
                <p>Le binaire sera dans <code>dist/agent</code></p>
                <h3>4. Configurer le serveur</h3>
                <p>Modifiez <code>config_agent.py</code> et définissez <code>SERVER_URL</code> avec l'adresse de votre serveur.</p>
                <h3>5. Lancer</h3>
                <pre>chmod +x dist/agent
./dist/agent</pre>
            `
        }
    };

    const guide = guides[os];
    title.textContent = guide.title;
    content.innerHTML = guide.html;
    modal.classList.add('open');
}

function closeGuide() {
    document.getElementById('guideModal').classList.remove('open');
}

setInterval(fetchMachines, 10000);
fetchMachines();
