const { contextBridge } = require("electron");

const BACKEND_PORT = process.env.PROCESSADOR_PORT || "8765";
const BACKEND_HOST = process.env.PROCESSADOR_HOST || "127.0.0.1";
const backendBaseUrl = `http://${BACKEND_HOST}:${BACKEND_PORT}`;

contextBridge.exposeInMainWorld("processador", {
  backendBaseUrl
});
