const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const config = require('../config');

const router = express.Router();

const BACKEND_DIR = path.join(__dirname, '..');
const AGENT_DIR   = path.join(__dirname, '../../agent');

/* ── Vérification mot de passe (côté serveur) ── */
router.post('/auth', (req, res) => {
    const { password } = req.body || {};
    if (password === config.DEPLOY_PASSWORD) {
        return res.json({ ok: true });
    }
    return res.status(401).json({ ok: false, error: 'Mot de passe incorrect' });
});

function buildZipServerJs() {
    const cssPath = path.join(BACKEND_DIR, 'public/css/style.css');
    const jsPath  = path.join(BACKEND_DIR, 'public/js/script.js');
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
    const js  = fs.existsSync(jsPath)  ? fs.readFileSync(jsPath,  'utf8') : '';

    return `const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./database');
const apiRoutes = require('./routes/api');
const deployRoutes = require('./routes/deploy');
const socketHandler = require('./middleware/socketHandler');
const cookieParser = require('cookie-parser');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: config.SOCKET_PING_INTERVAL,
  pingTimeout: config.SOCKET_PING_TIMEOUT
});

app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Inline static assets — guaranteed to load on any platform
const _CSS = ${JSON.stringify(css)};
const _JS  = ${JSON.stringify(js)};
app.get('/css/style.css', (_req, _res) => { _res.type('css').send(_CSS); });
app.get('/js/script.js',  (_req, _res) => { _res.type('js').send(_JS); });

app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => res.render('index.html'));
app.use('/api', apiRoutes(io));
app.use('/deploy', deployRoutes);

socketHandler(io);

const startServer = async () => {
  try {
    await db.initializeDatabase();
    server.listen(config.PORT, config.HOST, () => {
      console.log('Server running on http://' + config.HOST + ':' + config.PORT);
    });
    setInterval(db.cleanupOldMetrics, 3600000);
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
};

startServer();
`;
}

function addBackendCore(archive, extraFiles = {}) {
    // Use generated server.js with inline CSS/JS
    archive.append(buildZipServerJs(), { name: 'server.js' });

    const coreFiles = [
        'database.js',
        'config.js',
        'package.json',
        'package-lock.json',
    ];
    for (const f of coreFiles) {
        const fp = path.join(BACKEND_DIR, f);
        if (fs.existsSync(fp)) archive.file(fp, { name: f });
    }

    const dirs = [
        { src: 'routes',     dest: 'routes' },
        { src: 'middleware', dest: 'middleware' },
        { src: 'views',      dest: 'views' },
        { src: 'public',     dest: 'public' },
    ];
    for (const d of dirs) {
        const dp = path.join(BACKEND_DIR, d.src);
        if (fs.existsSync(dp)) archive.directory(dp, d.dest);
    }

    const agentFiles = [
        'agent.py',
        'system_info.py',
        'requirements.txt',
        'install-linux.sh',
        'install-linux-debian.sh',
        'install-linux-fedora.sh',
        'install-linux-arch.sh',
        'install-linux-opensuse.sh',
    ];
    for (const af of agentFiles) {
        const afp = path.join(AGENT_DIR, af);
        if (fs.existsSync(afp)) archive.file(afp, { name: path.join('agent', af) });
    }
    const exe = path.join(AGENT_DIR, 'node-monitor-agent.exe');
    if (fs.existsSync(exe)) archive.file(exe, { name: 'agent/node-monitor-agent.exe' });

    for (const [name, content] of Object.entries(extraFiles)) {
        archive.append(content, { name });
    }
}

/* ── Serve deploy page ── */
router.get('/', (req, res) => {
    res.render('deploy.html');
});

/* ── Vercel ── */
router.get('/download/vercel', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="l2ig2-vercel.zip"');
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    const vercelJson = JSON.stringify({
        version: 2,
        builds: [{ src: 'server.js', use: '@vercel/node' }],
        routes: [{ src: '/(.*)', dest: '/server.js' }]
    }, null, 2);

    const packageJson = JSON.stringify({
        name: 'l2ig2-monitor',
        version: '1.0.0',
        description: 'L2-IG2 Remote PC Monitoring — Vercel deploy',
        main: 'server.js',
        scripts: {
            start: 'node server.js',
            build: 'echo "No build step required"'
        },
        dependencies: {
            'better-sqlite3': '^9.4.3',
            'cookie-parser': '^1.4.7',
            cors: '^2.8.5',
            ejs: '^3.1.9',
            express: '^4.18.2',
            'socket.io': '^4.6.1',
            archiver: '^7.0.1'
        },
        engines: { node: '>=20' }
    }, null, 2);

    const envExample = `# Vercel — Variables d'environnement
PORT=3000
DB_PATH=/tmp/monitoring.db
NODE_ENV=production
`;

    const gitignore = `node_modules/
data/
*.db
*.db-shm
*.db-wal
.env
`;

    const readme = `# L2-IG2 Monitor — Déploiement Vercel

## Instructions

1. Importez ce dossier dans un dépôt GitHub
2. Connectez-le à Vercel (vercel.com/import)
3. Ajoutez la variable d'environnement \`DB_PATH=/tmp/monitoring.db\`
4. Déployez !

## ⚠️ Limitations Vercel

Vercel est une plateforme **serverless** — les fonctions sont sans état entre les appels.
- Les routes REST (/api/*) fonctionnent normalement.
- **Socket.io est limité** : le temps réel ne fonctionne pas de façon fiable.
  → Pour une surveillance en temps réel complète, préférez **Render** ou **Railway**.

## Variables d'environnement recommandées

| Variable | Valeur |
|----------|--------|
| DB_PATH  | /tmp/monitoring.db |
| NODE_ENV | production |
`;

    addBackendCore(archive, {
        'vercel.json':    vercelJson,
        'package.json':   packageJson,
        '.env.example':   envExample,
        '.gitignore':     gitignore,
        'README.md':      readme,
    });

    archive.finalize();
});

/* ── Render ── */
router.get('/download/render', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="l2ig2-render.zip"');
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    const renderYaml = `services:
  - type: web
    name: l2ig2-monitor
    env: node
    buildCommand: npm install
    startCommand: node server.js
    healthCheckPath: /
    envVars:
      - key: NODE_ENV
        value: production
      - key: DB_PATH
        value: /opt/render/project/src/data/monitoring.db
`;

    const dockerfile = `FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p data
EXPOSE 5000
ENV NODE_ENV=production
ENV PORT=5000
ENV DB_PATH=./data/monitoring.db
CMD ["node", "server.js"]
`;

    const dockerignore = `node_modules
data
*.db
*.db-shm
*.db-wal
.env
.git
attached_assets
`;

    const envExample = `# Render — Variables d'environnement
# PORT est assigné automatiquement par Render — ne pas définir manuellement
NODE_ENV=production
DB_PATH=/opt/render/project/src/data/monitoring.db
`;

    const gitignore = `node_modules/
data/
*.db
*.db-shm
*.db-wal
.env
`;

    const readme = `# L2-IG2 Monitor — Déploiement Render

## Instructions

1. Importez ce dossier dans un dépôt GitHub
2. Connectez-le à Render (render.com/new)
3. Choisissez **"New Web Service"** → sélectionnez votre dépôt
4. Render détecte automatiquement \`render.yaml\` et pré-remplit tout
5. Cliquez **"Create Web Service"** → Render build et démarre

## Variables d'environnement à définir dans Render

Dans l'onglet **"Environment"** de votre service Render :

| Variable | Valeur |
|----------|--------|
| NODE_ENV | production |
| DB_PATH  | /opt/render/project/src/data/monitoring.db |

⚠️ Ne définissez pas PORT — Render l'assigne automatiquement.

## ✅ Compatibilité complète

- Serveur Node.js persistant ✓
- Socket.io (temps réel) ✓
- \`better-sqlite3\` compilé correctement dans l'environnement Render ✓

## ⚠️ Persistance de la base de données

Sur le **plan gratuit** de Render, le disque est éphémère : la base de données
est réinitialisée à chaque déploiement. Pour conserver les données entre les
déploiements, activez un **Render Disk** (plan payant) monté sur
\`/opt/render/project/src/data\`.
`;

    addBackendCore(archive, {
        'render.yaml':    renderYaml,
        'Dockerfile':     dockerfile,
        '.dockerignore':  dockerignore,
        '.env.example':   envExample,
        '.gitignore':     gitignore,
        'README.md':      readme,
    });

    archive.finalize();
});

/* ── Railway ── */
router.get('/download/railway', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="l2ig2-railway.zip"');
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    const dockerfile = `FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p data
EXPOSE 5000
ENV NODE_ENV=production
ENV DB_PATH=./data/monitoring.db
CMD ["node", "server.js"]
`;

    const railwayJson = JSON.stringify({
        build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
        deploy: { startCommand: 'node server.js', healthcheckPath: '/', restartPolicyType: 'ON_FAILURE' }
    }, null, 2);

    const dockerignore = `node_modules
data
*.db
*.db-shm
*.db-wal
.env
.git
attached_assets
`;

    const envExample = `# Railway — Variables d'environnement
NODE_ENV=production
PORT=5000
DB_PATH=./data/monitoring.db
`;

    const gitignore = `node_modules/
data/
*.db
*.db-shm
*.db-wal
.env
`;

    const readme = `# L2-IG2 Monitor — Déploiement Railway

## Instructions

1. Importez ce dossier dans un dépôt GitHub
2. Connectez-le à Railway (railway.app/new)
3. Sélectionnez "Deploy from GitHub"
4. Railway détecte automatiquement le \`Dockerfile\`
5. Déployez !

## ✅ Compatibilité complète

- Serveur Node.js persistant ✓
- Socket.io (temps réel) ✓
- SQLite ✓

## Variables d'environnement

| Variable | Valeur |
|----------|--------|
| NODE_ENV | production |
| PORT     | 5000 (ou auto via \$PORT) |
| DB_PATH  | ./data/monitoring.db |
`;

    addBackendCore(archive, {
        'Dockerfile':     dockerfile,
        'railway.json':   railwayJson,
        '.dockerignore':  dockerignore,
        '.env.example':   envExample,
        '.gitignore':     gitignore,
        'README.md':      readme,
    });

    archive.finalize();
});

/* ── Docker générique ── */
router.get('/download/docker', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="l2ig2-docker.zip"');
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    const dockerfile = `FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p data
EXPOSE 5000
ENV NODE_ENV=production
ENV PORT=5000
ENV DB_PATH=./data/monitoring.db
CMD ["node", "server.js"]
`;

    const dockerCompose = `version: '3.8'
services:
  l2ig2-monitor:
    build: .
    container_name: l2ig2-monitor
    ports:
      - "\${PORT:-5000}:5000"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - PORT=5000
      - DB_PATH=./data/monitoring.db
    restart: unless-stopped
`;

    const dockerignore = `node_modules
*.db-shm
*.db-wal
.env
.git
attached_assets
`;

    const envExample = `# Docker — Variables d'environnement
NODE_ENV=production
PORT=5000
DB_PATH=./data/monitoring.db
`;

    const gitignore = `node_modules/
*.db-shm
*.db-wal
.env
`;

    const readme = `# L2-IG2 Monitor — Déploiement Docker

## Lancement rapide (Docker Compose)

\`\`\`bash
# Construire et démarrer
docker compose up -d

# Voir les logs
docker compose logs -f

# Arrêter
docker compose down
\`\`\`

Le dashboard sera accessible sur **http://localhost:5000**

## Lancement manuel (Docker seul)

\`\`\`bash
# Construire l'image
docker build -t l2ig2-monitor .

# Démarrer le conteneur
docker run -d \\
  --name l2ig2-monitor \\
  -p 5000:5000 \\
  -v \$(pwd)/data:/app/data \\
  l2ig2-monitor
\`\`\`

## ✅ Compatibilité complète

- Serveur Node.js persistant ✓
- Socket.io (temps réel) ✓
- SQLite persistant via volume Docker ✓

## Variables d'environnement

| Variable | Valeur par défaut |
|----------|-------------------|
| NODE_ENV | production |
| PORT     | 5000 |
| DB_PATH  | ./data/monitoring.db |
`;

    addBackendCore(archive, {
        'Dockerfile':         dockerfile,
        'docker-compose.yml': dockerCompose,
        '.dockerignore':      dockerignore,
        '.env.example':       envExample,
        '.gitignore':         gitignore,
        'README.md':          readme,
    });

    archive.finalize();
});

module.exports = router;
