#!/bin/bash
# Node Monitor - Installateur Linux
# Usage : chmod +x install-linux.sh && ./install-linux.sh

SERVER_URL="##SERVER_URL##"
INSTALL_DIR="$HOME/.node-monitor"

echo "======================================================"
echo "  Node Monitor - Installateur Linux"
echo "======================================================"
echo ""

# Vérification Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 n'est pas installé."
    echo "   Installez-le avec : sudo apt install python3 python3-pip"
    exit 1
fi
echo "✓ Python 3 détecté : $(python3 --version)"

# Installation de psutil
echo ""
echo "► Installation de psutil..."
pip3 install psutil --quiet 2>&1 || python3 -m pip install psutil --quiet 2>&1
if ! python3 -c "import psutil" &>/dev/null; then
    echo "❌ Impossible d'installer psutil."
    echo "   Essayez : sudo pip3 install psutil"
    exit 1
fi
echo "✓ psutil installé"

# Téléchargement de l'agent
echo ""
echo "► Téléchargement de l'agent depuis $SERVER_URL..."
mkdir -p "$INSTALL_DIR"

if command -v curl &>/dev/null; then
    curl -fsSL "${SERVER_URL}/api/download/agent" -o "$INSTALL_DIR/agent.py"
elif command -v wget &>/dev/null; then
    wget -q "${SERVER_URL}/api/download/agent" -O "$INSTALL_DIR/agent.py"
else
    echo "❌ curl ou wget requis. Installez-en un : sudo apt install curl"
    exit 1
fi

if [ $? -ne 0 ] || [ ! -s "$INSTALL_DIR/agent.py" ]; then
    echo "❌ Impossible de télécharger l'agent depuis $SERVER_URL"
    exit 1
fi
echo "✓ Agent téléchargé dans $INSTALL_DIR/agent.py"

# Création du script de lancement
echo ""
echo "► Création du script de lancement..."

cat > "$INSTALL_DIR/node-monitor-agent.sh" << LAUNCHEOF
#!/bin/bash
cd "\$(dirname "\$0")"
exec python3 agent.py --server "$SERVER_URL" "\$@"
LAUNCHEOF

chmod +x "$INSTALL_DIR/node-monitor-agent.sh"
echo "✓ Script de lancement créé : $INSTALL_DIR/node-monitor-agent.sh"

# Lien symbolique optionnel
if [ -w "/usr/local/bin" ] || sudo -n true 2>/dev/null; then
    sudo ln -sf "$INSTALL_DIR/node-monitor-agent.sh" /usr/local/bin/node-monitor-agent 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "✓ Commande globale disponible : node-monitor-agent"
    fi
fi

# Service systemd optionnel
echo ""
read -p "Installer comme service (démarrage automatique au boot) ? [o/N] " INSTALL_SERVICE
if [[ "$INSTALL_SERVICE" =~ ^[oOyY]$ ]]; then
    SERVICE_FILE="/etc/systemd/system/node-monitor-agent.service"
    sudo tee "$SERVICE_FILE" > /dev/null << SVCEOF
[Unit]
Description=Node Monitor Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
ExecStart=/usr/bin/python3 $INSTALL_DIR/agent.py --server $SERVER_URL
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVCEOF

    if [ $? -eq 0 ]; then
        sudo systemctl daemon-reload
        sudo systemctl enable node-monitor-agent
        sudo systemctl start node-monitor-agent
        echo "✓ Service installé et démarré"
        echo ""
        echo "  Commandes utiles :"
        echo "  sudo systemctl status node-monitor-agent"
        echo "  sudo systemctl stop node-monitor-agent"
        echo "  sudo journalctl -u node-monitor-agent -f"
    else
        echo "❌ Impossible de créer le service systemd (droits insuffisants ?)"
    fi
else
    echo ""
    echo "======================================================"
    echo "  Installation terminée !"
    echo "======================================================"
    echo ""
    echo "  Lancer l'agent :"
    echo "    bash $INSTALL_DIR/node-monitor-agent.sh"
    echo ""
    echo "  Ou directement :"
    echo "    python3 $INSTALL_DIR/agent.py --server $SERVER_URL"
    echo ""
    echo "  L'agent envoie les métriques toutes les 5 secondes."
    echo "  Arrêt : Ctrl+C"
    echo ""
fi
