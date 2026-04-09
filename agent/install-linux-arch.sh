#!/bin/bash
# L2-IG2 Monitor - Installateur Linux (Arch Linux / Manjaro / EndeavourOS / Garuda)
# Usage : chmod +x install-linux-arch.sh && ./install-linux-arch.sh

SERVER_URL="##SERVER_URL##"
INSTALL_DIR="$HOME/l2ig2-monitor"
SERVICE_NAME="l2ig2-monitor-agent"

echo "======================================================"
echo "  L2-IG2 Monitor - Installateur Arch Linux / Manjaro"
echo "======================================================"
echo ""

# Vérification Python 3
if ! command -v python3 &> /dev/null; then
    echo "► Python 3 non détecté, installation via pacman..."
    sudo pacman -S --noconfirm python
    if ! command -v python3 &> /dev/null; then
        echo "❌ Impossible d'installer Python 3."
        exit 1
    fi
fi
echo "✓ Python 3 détecté : $(python3 --version)"

# Installation de psutil
echo ""
echo "► Installation de psutil..."
# Sur Arch, psutil est disponible dans les dépôts officiels
if python3 -c "import psutil" &>/dev/null; then
    echo "✓ psutil déjà présent"
else
    # Essai via pip (nécessite python-pip)
    if command -v pip &>/dev/null || command -v pip3 &>/dev/null; then
        pip install psutil --quiet 2>&1 || pip3 install psutil --quiet 2>&1
    else
        # Installer depuis les dépôts Arch
        sudo pacman -S --noconfirm python-psutil
    fi
fi

if ! python3 -c "import psutil" &>/dev/null; then
    echo "❌ Impossible d'installer psutil."
    echo "   Essayez : sudo pacman -S python-psutil"
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
    echo "► curl non trouvé, installation..."
    sudo pacman -S --noconfirm curl
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
