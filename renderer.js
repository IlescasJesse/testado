const processBtn = document.getElementById("processBtn");
const fileInput = document.getElementById("fileInput");
const loadFilesBtn = document.getElementById("loadFilesBtn");
const uploadArea = document.getElementById("uploadArea");
const loadingOverlay = document.getElementById("loadingOverlay");
const progressInfo = document.getElementById("progressInfo");
const resultsModal = document.getElementById("resultsModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const successCount = document.getElementById("successCount");
const errorCount = document.getElementById("errorCount");
const downloadZipBtn = document.getElementById("downloadZipBtn");
const clearFilesBtn = document.getElementById("clearFilesBtn");
const retryErrorsBtn = document.getElementById("retryErrorsBtn");
const openFolderBtn = document.getElementById("openFolderBtn");
const resultsTable = document.getElementById("resultsTable"); // Ya es el tbody

let selectedFiles = [];
let pollingInterval = null;
let allFiles = []; // Guardar todos los archivos procesados
let currentFilter = "all"; // Filtro actual: all, success, error

// Manejar carga de archivos
loadFilesBtn.addEventListener("click", () => {
  fileInput.click();
});

// Usar delegación de eventos para que funcione después de innerHTML
uploadArea.addEventListener("click", (e) => {
  // No activar si se hizo clic en un botón
  if (e.target.tagName !== "BUTTON" && !e.target.closest("button")) {
    fileInput.click();
  }
});

// Drag and drop
uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("dragover");
});

uploadArea.addEventListener("dragleave", () => {
  uploadArea.classList.remove("dragover");
});

uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("dragover");

  const files = Array.from(e.dataTransfer.files).filter((f) =>
    f.name.toLowerCase().endsWith(".pdf")
  );
  if (files.length > 0) {
    selectedFiles = files;
    showFileCount();
  } else {
    alert("Solo puedes cargar archivos PDF");
  }
});

fileInput.addEventListener("change", (e) => {
  const files = Array.from(e.target.files);
  const pdfFiles = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));

  if (pdfFiles.length === 0 && files.length > 0) {
    alert("Solo puedes cargar archivos PDF");
    e.target.value = "";
    return;
  }

  selectedFiles = pdfFiles;
  showFileCount();
});

function showFileCount() {
  const count = selectedFiles.length;
  if (count > 0) {
    const fileText = document.createElement("div");
    fileText.className = "upload-content";
    fileText.innerHTML = `
      <div class="upload-icon">📁</div>
      <div class="upload-text">${count} archivo${
      count > 1 ? "s" : ""
    } seleccionado${count > 1 ? "s" : ""}</div>
      <div class="upload-subtext">Haz clic en "Procesar PDFs" para comenzar</div>
    `;
    uploadArea.innerHTML = "";
    uploadArea.appendChild(fileText);
    processBtn.disabled = false;
  } else {
    const fileText = document.createElement("div");
    fileText.className = "upload-content";
    fileText.innerHTML = `
      <div class="upload-icon">📄</div>
      <div class="upload-text">Arrastra archivos PDF aquí</div>
      <div class="upload-subtext">o haz clic para seleccionar (máximo 1000 archivos)</div>
    `;
    uploadArea.innerHTML = "";
    uploadArea.appendChild(fileText);
    processBtn.disabled = true;
  }
}

// Procesar archivos
processBtn.addEventListener("click", async () => {
  if (selectedFiles.length === 0) {
    alert("Selecciona al menos un archivo PDF");
    return;
  }

  if (selectedFiles.length > 1000) {
    alert("Solo puedes procesar máximo 1000 archivos a la vez");
    return;
  }

  // Deshabilitar botón mientras procesa
  processBtn.disabled = true;
  processBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';

  const formData = new FormData();
  selectedFiles.forEach((file) => {
    formData.append("pdfs", file);
  });

  try {
    showLoading(
      `Iniciando procesamiento de ${selectedFiles.length} archivos...`
    );

    const response = await fetch("/api/process", {
      method: "POST",
      body: formData,
    });

    const result = await response.json();

    if (result.success && result.processing) {
      // Iniciar polling para ver progreso
      startPolling(result.totalFiles);
    } else {
      throw new Error(result.message || "No se pudieron procesar los archivos");
    }
  } catch (error) {
    hideLoading();
    const mensaje = error.message.includes("fetch")
      ? "No se pudo conectar con el servidor. Verifica que esté funcionando."
      : error.message;
    alert(mensaje);
    processBtn.disabled = false;
    processBtn.innerHTML = '<i class="fas fa-check-double"></i> Procesar PDFs';
  }
});

function showLoading(message) {
  progressInfo.textContent = message;
  loadingOverlay.style.display = "flex";
}

function hideLoading() {
  loadingOverlay.style.display = "none";
  clearInterval(pollingInterval);
  pollingInterval = null;
}

function startPolling(totalFiles) {
  let lastCount = 0;
  const startTime = Date.now();

  pollingInterval = setInterval(async () => {
    try {
      const response = await fetch("/api/get-files");
      const data = await response.json();

      if (data.success) {
        const processedCount = data.files.length;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        showLoading(
          `Procesando: ${processedCount}/${totalFiles} archivos (${elapsed}s)`
        );

        // Si se completó el procesamiento
        if (processedCount >= totalFiles) {
          clearInterval(pollingInterval);
          pollingInterval = null;
          hideLoading();
          showResults(data.files);
        }

        lastCount = processedCount;
      }
    } catch (error) {
      console.error("Error al consultar progreso:", error);
      // Continuar intentando
    }
  }, 1000); // Verificar cada segundo
}

function showResults(files) {
  allFiles = files; // Guardar para filtrar después
  const successful = files.filter((f) => f.success);
  const failed = files.filter((f) => !f.success);

  successCount.textContent = successful.length;
  errorCount.textContent = failed.length;

  // Mostrar/ocultar botón de reprocesar
  if (failed.length > 0) {
    retryErrorsBtn.style.display = "inline-block";
  } else {
    retryErrorsBtn.style.display = "none";
  }

  // Filtrar y mostrar archivos según filtro actual
  filterResults(currentFilter);

  resultsModal.style.display = "flex";

  // Resetear botón y archivos
  processBtn.disabled = false;
  processBtn.innerHTML = '<i class="fas fa-check-double"></i> Procesar PDFs';
  selectedFiles = [];
  fileInput.value = "";
  showFileCount();
}

function filterResults(filter) {
  currentFilter = filter;
  let filteredFiles = allFiles;

  if (filter === "success") {
    filteredFiles = allFiles.filter((f) => f.success);
  } else if (filter === "error") {
    filteredFiles = allFiles.filter((f) => !f.success);
  }

  // Actualizar tabs activos
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.dataset.tab === filter) {
      btn.classList.add("active");
    }
  });

  // Llenar tabla
  resultsTable.innerHTML = "";

  if (filteredFiles.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML =
      '<td colspan="4" style="text-align: center; padding: 20px;">No hay archivos en esta categoría</td>';
    resultsTable.appendChild(row);
    return;
  }

  filteredFiles.forEach((file) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${file.filename}</td>
      <td>${
        file.success
          ? '<span style="color: #28a745;">✓ Exitoso</span>'
          : '<span style="color: #dc3545;">✗ Error</span>'
      }</td>
      <td>${
        file.processingTime
          ? (file.processingTime / 1000).toFixed(2) + "s"
          : "-"
      }</td>
      <td>${file.error || "-"}</td>
    `;
    resultsTable.appendChild(row);
  });
}

// Cerrar modal
closeModalBtn.addEventListener("click", () => {
  resultsModal.style.display = "none";
  currentFilter = "all"; // Resetear filtro
});

// Tabs de filtrado
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    filterResults(btn.dataset.tab);
  });
});

// Click en tarjetas de resumen para filtrar
document.getElementById("showSuccessTab").addEventListener("click", () => {
  filterResults("success");
});

document.getElementById("showErrorTab").addEventListener("click", () => {
  filterResults("error");
});

// Descargar ZIP
downloadZipBtn.addEventListener("click", () => {
  window.location.href = "/api/download-zip";
});

// Reprocesar archivos con errores
retryErrorsBtn.addEventListener("click", async () => {
  const failedFiles = allFiles.filter((f) => !f.success);

  if (failedFiles.length === 0) {
    alert("No hay archivos con errores para reprocesar");
    return;
  }

  if (
    !confirm(
      `¿Reprocesar ${failedFiles.length} archivo${
        failedFiles.length > 1 ? "s" : ""
      } con error?`
    )
  ) {
    return;
  }

  // Cerrar modal actual
  resultsModal.style.display = "none";

  // Deshabilitar botón mientras procesa
  processBtn.disabled = true;
  processBtn.innerHTML =
    '<i class="fas fa-spinner fa-spin"></i> Reprocesando...';

  try {
    showLoading(
      `Iniciando reprocesamiento de ${failedFiles.length} archivos...`
    );

    const response = await fetch("/api/retry-errors", {
      method: "POST",
    });

    const result = await response.json();

    if (result.success && result.processing) {
      // Iniciar polling para ver progreso
      startPolling(result.totalFiles);
    } else if (result.success && result.totalFiles === 0) {
      hideLoading();
      alert("No hay archivos con error para reprocesar");
      processBtn.disabled = false;
      processBtn.innerHTML =
        '<i class="fas fa-check-double"></i> Procesar PDFs';
    } else {
      throw new Error(
        result.message || "No se pudieron reprocesar los archivos"
      );
    }
  } catch (error) {
    hideLoading();
    const mensaje = error.message.includes("fetch")
      ? "No se pudo conectar con el servidor. Verifica que esté funcionando."
      : error.message;
    alert(mensaje);
    processBtn.disabled = false;
    processBtn.innerHTML = '<i class="fas fa-check-double"></i> Procesar PDFs';
  }
});

// Limpiar carpeta
clearFilesBtn.addEventListener("click", async () => {
  if (confirm("¿Estás seguro de limpiar todos los archivos procesados?")) {
    try {
      const response = await fetch("/api/clear-files", {
        method: "POST",
      });
      const result = await response.json();
      if (result.success) {
        alert("Carpeta limpiada correctamente");
        resultsModal.style.display = "none";
      } else {
        alert("Error al limpiar la carpeta");
      }
    } catch (error) {
      alert("No se pudo limpiar la carpeta. Verifica la conexión.");
    }
  }
});

// Abrir carpeta (solo en Electron)
if (openFolderBtn) {
  openFolderBtn.addEventListener("click", async () => {
    if (window.electron && window.electron.openTestedFolder) {
      await window.electron.openTestedFolder();
    } else {
      alert("Esta función solo funciona en la versión de escritorio");
    }
  });
}

// Ver contratos testados actuales
const viewContractsBtn = document.getElementById("viewContractsBtn");
if (viewContractsBtn) {
  viewContractsBtn.addEventListener("click", async () => {
    try {
      const response = await fetch("/api/get-files");
      const data = await response.json();
      if (data.success) {
        if (data.files.length === 0) {
          alert("No hay contratos testados en la carpeta.");
        } else {
          showResults(data.files);
        }
      } else {
        alert("No se pudo obtener la lista de archivos.");
      }
    } catch (error) {
      alert("Error al consultar los archivos.");
    }
  });
}

// Limpiar archivos desde botón principal
const clearMainBtn = document.getElementById("clearMainBtn");
if (clearMainBtn) {
  clearMainBtn.addEventListener("click", async () => {
    if (confirm("¿Estás seguro de limpiar todos los archivos procesados?")) {
      try {
        const response = await fetch("/api/clear-files", { method: "POST" });
        const result = await response.json();
        if (result.success) {
          alert("Archivos limpiados correctamente.");
          resultsModal.style.display = "none";
        } else {
          alert("Error al limpiar los archivos.");
        }
      } catch (error) {
        alert("No se pudo limpiar. Verifica la conexión.");
      }
    }
  });
}

// Inicializar
showFileCount();
