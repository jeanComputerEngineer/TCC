from __future__ import annotations

import os
import shutil
import time
from pathlib import Path


def ensure_pyinstaller() -> None:
    try:
        import PyInstaller  # noqa: F401
    except ImportError as exc:
        raise SystemExit(
            "PyInstaller não encontrado. Instale com 'pip install pyinstaller'."
        ) from exc


def build_backend(executable_name: str) -> Path:
    from PyInstaller.__main__ import run as pyinstaller_run

    electron_app_dir = Path(__file__).resolve().parents[1]
    repo_root = electron_app_dir.parent
    backend_dir = repo_root / "Backend"

    dist_dir = backend_dir / "dist-pyinstaller"
    build_dir = backend_dir / "build-pyinstaller"

    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    if build_dir.exists():
        shutil.rmtree(build_dir)

    add_data = f"{(backend_dir / 'app').resolve()}{os.pathsep}app"
    args = [
        "--noconfirm",
        "--clean",
        "--onefile",
        f"--name={executable_name}",
        f"--specpath={build_dir}",
        "--hidden-import=skimage._shared.geometry",
        "--hidden-import=skimage._shared.transform",
        "--hidden-import=scipy._lib.messagestream",
        "--hidden-import=PIL._imaging",
        "--hidden-import=cv2",
        "--hidden-import=numpy",
        "--hidden-import=scipy",
        "--hidden-import=skimage",
        "--hidden-import=fastapi",
        "--hidden-import=uvicorn",
        "--collect-submodules=skimage",
        "--collect-submodules=scipy",
        "--collect-data=skimage",
        "--collect-data=scipy",
        "--collect-data=cv2",
        "--collect-data=fastapi",
        "--collect-data=uvicorn",
        "--collect-data=PIL",
        "--collect-data=numpy",
        f"--distpath={dist_dir}",
        f"--workpath={build_dir}",
        f"--paths={backend_dir}",
        f"--add-data={add_data}",
        str(backend_dir / "start_server.py"),
    ]
    pyinstaller_run(args)
    produced_exe = dist_dir / f"{executable_name}.exe"
    if not produced_exe.exists():
        raise SystemExit(f"Arquivo não encontrado: {produced_exe}")
    return produced_exe


def copy_to_resources(executable_path: Path) -> None:
    electron_app_dir = Path(__file__).resolve().parents[1]
    target_dir = electron_app_dir / "resources" / "python"
    target_dir.mkdir(parents=True, exist_ok=True)

    def copy_with_retry(source: Path, target: Path) -> None:
        last_error: Exception | None = None
        for _ in range(10):
            try:
                shutil.copy2(source, target)
                return
            except PermissionError as exc:
                last_error = exc
                time.sleep(1)
        raise SystemExit(
            f"Nao foi possivel atualizar {target}. Feche o aplicativo/processo do backend e tente novamente."
        ) from last_error

    # Copia com o nome oficial
    target_path = target_dir / executable_path.name
    copy_with_retry(executable_path, target_path)
    print(f"Backend empacotado copiado para {target_path}")

    # Copia extra com nome legado para compatibilidade (ex.: instaladores antigos)
    legacy_path = target_dir / "root-analyzer-backend.exe"
    try:
        copy_with_retry(executable_path, legacy_path)
        print(f"Cópia adicional do backend (legado) em {legacy_path}")
    except Exception as e:
        print(f"Aviso: não foi possível criar cópia legada: {e}")


def main() -> None:
    ensure_pyinstaller()
    exe = build_backend("processador-backend")
    copy_to_resources(exe)


if __name__ == "__main__":
    main()
