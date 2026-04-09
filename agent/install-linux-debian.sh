#!/bin/bash
# L2-IG2 Monitor - Installateur Linux (Debian / Ubuntu / Mint / Pop!_OS)
# Usage : chmod +x install-linux-debian.sh && ./install-linux-debian.sh

SERVER_URL="##SERVER_URL##"
INSTALL_DIR="$HOME/l2ig2-monitor"
SERVICE_NAME="l2ig2-monitor-agent"

echo "======================================================"
echo "  L2-IG2 Monitor - Installateur Debian / Ubuntu"
echo "======================================================"
echo ""

# Vérification Python 3
if ! command -v python3 &> /dev/null; then
    echo "► Python 3 non détecté, installation..."
    sudo apt-get update -qq
    sudo apt-get install -y python3 python3-pip
    if ! command -v python3 &> /dev/null; then
        echo "❌ Impossible d'installer Python 3."
        exit 1
    fi
fi
echo "✓ Python 3 détecté : $(python3 --version)"

# Vérification pip
if ! command -v pip3 &> /dev/null && ! python3 -m pip --version &>/dev/null; then
    echo "► pip3 non détecté, installation..."
    sudo apt-get install -y python3-pip
fi

# Installation de psutil
echo ""
echo "► Installation de psutil..."
pip3 install psutil --quiet 2>&1 || \
    python3 -m pip install psutil --quiet 2>&1 || \
    sudo apt-get install -y python3-psutil -qq 2>&1
if ! python3 -c "import psutil" &>/dev/null; then
    echo "❌ Impossible d'installer psutil."
    echo "   Essayez : sudo apt-get install python3-psutil"
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
    echo "► curl/wget non trouvés, installation de curl..."
    sudo apt-get install -y curl -qq
    curl -fsSL "${SERVER_URL}/api/download/agent" -o "$INSTALL_DIR/agent.py"
fi

if [ $? -ne 0 ] || [ ! -s "$INSTALL_DIR/agent.py" ]; then
    echo "❌ Impossible de télécharger l'agent depuis $SERVER_URL"
    exit 1
fi
echo "✓ Agent téléchargé dans $INSTALL_DIR/agent.py"

# Création du script de lancement
echo ""
echo "► Création du script de lancement..."

cat > "$INSTALL_DIR/${SERVICE_NAME}.sh" << LAUNCHEOF
#!/bin/bash
cd "\$(dirname "\$0")"
exec python3 agent.py --server "$SERVER_URL" "\$@"
LAUNCHEOF

chmod +x "$INSTALL_DIR/${SERVICE_NAME}.sh"
echo "✓ Script de lancement : $INSTALL_DIR/${SERVICE_NAME}.sh"

# Lien symbolique dans /usr/local/bin
if sudo -n true 2>/dev/null || [ -w "/usr/local/bin" ]; then
    sudo ln -sf "$INSTALL_DIR/${SERVICE_NAME}.sh" "/usr/local/bin/${SERVICE_NAME}" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "✓ Commande globale disponible : ${SERVICE_NAME}"
    fi
fi

# Service systemd optionnel
echo ""
read -p "Installer comme service (démarrage automatique au boot) ? [o/N] " INSTALL_SERVICE
if [[ "$INSTALL_SERVICE" =~ ^[oOyY]$ ]]; then
    SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
    sudo tee "$SERVICE_FILE" > /dev/null << SVCEOF
[Unit]
Description=L2-IG2 Monitor Agent
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
        sudo systemctl enable "${SERVICE_NAME}"
        sudo systemctl start "${SERVICE_NAME}"
        echo "✓ Service installé et démarré"
        echo ""
        echo "  Commandes utiles :"
        echo "  sudo systemctl status ${SERVICE_NAME}"
        echo "  sudo systemctl stop ${SERVICE_NAME}"
        echo "  sudo journalctl -u ${SERVICE_NAME} -f"
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
    echo "    bash $INSTALL_DIR/${SERVICE_NAME}.sh"
    echo ""
    echo "  Ou directement :"
    echo "    python3 $INSTALL_DIR/agent.py --server $SERVER_URL"
    echo ""
    echo "  L'agent envoie les métriques toutes les 5 secondes."
    echo "  Arrêt : Ctrl+C"
    echo ""
fi
