# L2-IG2 Monitor - Architecture et Fonctionnement

Ce document décrit en détail le fonctionnement du projet L2-IG2 Monitor, ses composants clés, l'architecture des fichiers et les API utilisées. Il est conçu pour servir de base à un exposé technique.

---

## 1. Vue d'ensemble du système

**L2-IG2 Monitor** est une application client-serveur de surveillance de parc informatique en temps réel.
Elle se divise en deux grandes parties :
1. **Le Serveur (Backend & Frontend)** : Une application Node.js (Express + Socket.io) avec une base de données SQLite. Elle reçoit les données, les stocke et les affiche sur un tableau de bord web interactif.
2. **L'Agent (Client)** : Un script Python léger tournant sur les machines cibles (Windows, Linux, macOS). Il récolte les métriques système et les envoie au serveur à intervalles réguliers.

---

## 2. Arbre d'Architecture (Structure des fichiers)

```text
node-monitor-main/
├── package.json               # Dépendances Node.js globales
├── replit.md                  # Documentation rapide / contexte
├── backend/                   # LE SERVEUR
│   ├── server.js              # Point d'entrée principal (Express & Socket.io)
│   ├── database.js            # Gestionnaire de base de données (SQLite3)
│   ├── package.json           # Dépendances spécifiques au backend
│   ├── routes/
│   │   ├── api.js             # API REST (Réception des métriques, requêtes du front)
│   │   └── deploy.js          # Génération des scripts d'installation & agents
│   └── public/                # Interface Utilisateur (Tableau de bord)
│       ├── index.html         # Structure HTML du dashboard
│       ├── css/style.css      # Style Vanilla CSS (Thème sombre)
│       └── js/script.js       # Logique front-end (Graphiques, WebSockets, Identification)
│
└── agent/                     # LE CLIENT
    ├── agent.py               # Code principal de l'agent (Tkinter + psutil)
    ├── build_agent.py         # Script de compilation PyInstaller (vers .exe)
    ├── icon.ico               # Icône de l'exécutable
    └── install-linux-*.sh     # Scripts d'installation automatisés pour Linux
```

---

## 3. Les Composants Clés

### A. Le Backend (Node.js)
*   **Express.js** : Gère le routage HTTP, l'API REST et sert les fichiers statiques HTML/CSS/JS.
*   **Socket.IO** : Établit une connexion WebSocket bidirectionnelle avec les navigateurs (Dashboard) pour pousser les nouvelles métriques système en **temps réel** sans avoir besoin de rafraîchir la page.
*   **SQLite3** : Base de données asynchrone légère stockant l'historique de présence des machines et leurs paramètres.

### B. Le Frontend (Vanilla JS)
*   **Chart.js** : Utilisé pour dessiner les graphiques d'historique CPU/RAM en direct de manière fluide.
*   **Logique d'identification (Ma Machine)** : Le front-end implémente un système astucieux à trois niveaux (Cookie, WebRTC mDNS, et IP Publique) pour deviner automatiquement quelle machine du dashboard correspond à l'ordinateur qui navigue sur la page.

### C. L'Agent (Python)
*   **psutil** : Bibliothèque Python fondamentale pour lire les sondes matérielles (Utilisation CPU, RAM libre/occupée, Débit réseau Rx/Tx, Partitions disques).
*   **Tkinter** : Interface graphique minimale et autonome pour Windows (permettant à l'utilisateur de lancer l'agent et de voir son statut sans avoir besoin d'une console noire ouverte).
*   **PyInstaller** : Utilisé pour compiler `agent.py` en un seul exécutable binaire autonome (`.exe`), rendant le déploiement sur Windows extrêmement simple (zéro dépendance requise chez le client final).

---

## 4. Les API Utilisées

### A. API Web Natives & Bibliothèques Frontend
Dans le navigateur (`script.js`), le projet s'appuie sur plusieurs API et standards modernes :
*   **WebRTC API (`RTCPeerConnection`)** : Utilisée de manière ingénieuse en arrière-plan pour scanner et découvrir l'adresse IP locale de l'ordinateur afin de le faire correspondre à l'agent.
*   **Fetch API** : Pour les appels asynchrones (AJAX) standards (récupération de la configuration, changement de la fréquence de mise à jour).
*   **WebSocket API (via Socket.IO)** : Pour maintenir un canal de communication bidirectionnel et continu avec le serveur et recevoir les mises à jour instantanément.
*   **Canvas API (via Chart.js)** : Pour le rendu matériel accéléré des graphiques d'historique de consommation CPU/RAM.

### B. API REST (Communication Client-Serveur)
La communication entre l'agent et le serveur, ainsi qu'une partie de la communication du site, se fait via des appels HTTP REST.

| Endpoint (URL) | Méthode | Rôle |
| :--- | :--- | :--- |
| `/api/agent-report` | **POST** | Route critique. L'agent envoie son JSON contenant CPU, RAM, Disques, OS, Interfaces réseaux. Le serveur l'enregistre et l'émet sur le WebSocket vers les navigateurs. |
| `/api/agent-disconnect` | **POST** | Signal envoyé par l'agent lorsqu'il s'arrête proprement (clic sur le bouton "Arrêter" ou fermeture de l'app). |
| `/api/machines` | **GET** | Utilisé par le navigateur pour charger la liste initiale des machines connectées et hors ligne. |
| `/api/identify` | **GET** | Route utilisée par le navigateur pour s'identifier. Elle vérifie les cookies et l'IP source pour renvoyer le `machine_id` correspondant. |
| `/api/download/*` | **GET** | Téléchargement dynamique de l'agent. Le serveur modifie l'agent à la volée pour y injecter sa propre adresse. |

---

## 5. Flux de données (Exemple de cycle de vie)

1. **Déploiement** : L'utilisateur clique sur "Télécharger l'agent" depuis l'interface web. Le serveur Node.js génère un `node-monitor-agent.exe` en intégrant l'adresse du serveur à l'intérieur.
2. **Exécution** : L'agent démarre. Il crée un ID unique basé sur son adresse MAC physique et son nom d'hôte (`hostname`), sauvegardé de façon persistante.
3. **Collecte** : Chaque seconde (ou fréquence définie), `psutil` lit la charge CPU et la RAM.
4. **Transmission** : L'agent envoie une requête `POST /api/agent-report` avec un objet JSON.
5. **Réception** : `server.js` reçoit le JSON, met à jour le champ "last_seen" en base de données.
6. **Diffusion** : `server.js` utilise `socket.emit('metrics_update', data)` pour pousser instantanément ces données à tous les utilisateurs connectés sur le site web.
7. **Affichage** : Le navigateur reçoit le WebSocket et met à jour les jauges et le graphique `Chart.js`.
