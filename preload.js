const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  getPdfList: () => ipcRenderer.invoke("get-pdf-list"),
  getPdfPath: (filename) => ipcRenderer.invoke("get-pdf-path", filename),
  openSettings: () => ipcRenderer.invoke("open-settings"),
  openTestedFolder: () => ipcRenderer.invoke("open-tested-folder"),
  processPdfs: (fileList, censorRegions) =>
    ipcRenderer.invoke("process-pdfs", fileList, censorRegions),
  saveConfig: (contractName, config) =>
    ipcRenderer.invoke("save-config", contractName, config),
  loadConfig: (contractName) => ipcRenderer.invoke("load-config", contractName),
});
