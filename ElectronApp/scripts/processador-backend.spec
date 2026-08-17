# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files
from PyInstaller.utils.hooks import collect_submodules

datas = [('C:\\Users\\jsche\\OneDrive\\Área de Trabalho\\Projetos\\TCC\\Backend\\app', 'app')]
hiddenimports = ['skimage._shared.geometry', 'skimage._shared.transform', 'scipy._lib.messagestream', 'PIL._imaging', 'cv2', 'numpy', 'scipy', 'skimage', 'fastapi', 'uvicorn']
datas += collect_data_files('skimage')
datas += collect_data_files('scipy')
datas += collect_data_files('cv2')
datas += collect_data_files('fastapi')
datas += collect_data_files('uvicorn')
datas += collect_data_files('PIL')
datas += collect_data_files('numpy')
hiddenimports += collect_submodules('skimage')
hiddenimports += collect_submodules('scipy')


a = Analysis(
    ['C:\\Users\\jsche\\OneDrive\\Área de Trabalho\\Projetos\\TCC\\Backend\\start_server.py'],
    pathex=['C:\\Users\\jsche\\OneDrive\\Área de Trabalho\\Projetos\\TCC\\Backend'],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='processador-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
