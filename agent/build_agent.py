import PyInstaller.__main__
import sys
import platform
import os

def build():
    args = [
        'agent.py',
        '-F',
        '--hidden-import=psutil',
        '--name=node-monitor-agent',
        '--distpath=.',
        '--specpath=build',
        '--clean'
    ]
    
    if platform.system() == 'Windows':
        args.append('-w')
        
    # Ajout de l'icône avec un chemin absolu pour éviter le bug de PyInstaller avec specpath
    icon_path = os.path.abspath('icon.ico')
    if os.path.exists(icon_path):
        args.append(f'--icon={icon_path}')
        
    PyInstaller.__main__.run(args)

if __name__ == '__main__':
    print("Compilation de l'agent...")
    build()
    print("✓ Compilation terminée!")