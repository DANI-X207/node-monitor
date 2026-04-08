import PyInstaller.__main__
import sys
import platform

def build():
    PyInstaller.__main__.run([
        'agent.py',
        '-F',
        '-w' if platform.system() == 'Windows' else '',
        '--hidden-import=psutil',
        '--name=PCMonitorAgent',
        '--distpath=dist',
        '--specpath=build'
    ])

if __name__ == '__main__':
    print("Compilation de l'agent...")
    build()
    print("✓ Compilation terminée!")