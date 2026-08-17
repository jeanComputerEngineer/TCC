import os
from uvicorn import Config, Server


def create_server() -> Server:
    host = os.getenv("PROCESSADOR_HOST", "127.0.0.1")
    port = int(os.getenv("PROCESSADOR_PORT", "8765"))
    log_level = os.getenv("PROCESSADOR_LOG_LEVEL", "info")
    from app.main import app  # import only when needed to keep startup fast

    config = Config(
        app,
        host=host,
        port=port,
        log_level=log_level,
        workers=1,
        timeout_keep_alive=30,
    )
    return Server(config)


def main() -> None:
    server = create_server()
    server.run()


if __name__ == "__main__":
    main()
