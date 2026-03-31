// ============================================
// CONFIGURACIÓN Y CONSTANTES
// ============================================

const DEFAULT_CONFIG_NAME = "_CONFIGURACION_UNICA";

// Plantilla base de regiones (mm)
const BASE_REGIONS_ALL_PAGES = [
  { x: 189.9, y: 3.0, width: 18.0, height: 231.0, color: "#FFFFFF" },
  { x: 0.5, y: 1.4, width: 19.8, height: 272.5, color: "#FFFFFF" },
];

const EXTRA_REGIONS_PAGE_2 = [
  { x: 127.1, y: 94.4, width: 31.7, height: 4.0, color: "#000000" },
];

const EXTRA_REGIONS_PAGE_6 = [
  { x: 119.8, y: 82.8, width: 40.0, height: 17.0, color: "#000000" },
];

// ============================================
// ESTADO GLOBAL
// ============================================
let currentPdf = null;
let currentPage = 1;
let totalPages = 1;
let pageRegions = {}; // Almacena regiones por página
let selectedRegionIndex = null;
let isDrawingMode = false;
let drawStart = null;

// ============================================
// ELEMENTOS DOM
// ============================================
const canvas = document.getElementById("pdfCanvas");
const ctx = canvas.getContext("2d");
const sampleFileInput = document.getElementById("sampleFileInput");
const loadSampleBtn = document.getElementById("loadSampleBtn");
const loadedSampleName = document.getElementById("loadedSampleName");
// legacy: contractSelect may not exist in new UI
const contractSelect = document.getElementById("contractSelect");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const currentPageDisplay = document.getElementById("currentPageDisplay");
const totalPagesDisplay = document.getElementById("totalPagesDisplay");
const addRegionBtn = document.getElementById("addRegionBtn");
const loadPredefinedBtn = document.getElementById("loadPredefinedBtn");
const saveConfigBtn = document.getElementById("saveConfigBtn");
const regionsList = document.getElementById("regionsList");
const backBtn = document.getElementById("backBtn");
const presetIndicator = document.getElementById("presetIndicator");
// Estado adicional
let sampleFileName = null;
let pageBaseImage = {}; // store ImageData per page to avoid redraw artifacts
let activePresetName = DEFAULT_CONFIG_NAME; // configuración única activa

// ============================================
// INICIALIZACIÓN
// ============================================

// Configurar PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// Validar que el canvas exista
if (!canvas || !ctx) {
  console.error("Error: Canvas no encontrado en el DOM");
}

// ============================================
// EVENTO: Volver al inicio
// ============================================
if (backBtn) {
  backBtn.addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

// ============================================
// EVENTO: Cargar archivo local desde input
// ============================================
if (loadSampleBtn && sampleFileInput) {
  loadSampleBtn.addEventListener("click", () => {
    sampleFileInput.click();
  });

  sampleFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validar que sea PDF
    if (!file.type.includes("pdf") && !file.name.endsWith(".pdf")) {
      alert("Por favor selecciona un archivo PDF válido");
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      currentPdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      currentPage = 1;
      totalPages = currentPdf.numPages;
      sampleFileName = file.name;
      pageRegions = {}; // Limpiar regiones
      pageBaseImage = {}; // Limpiar imágenes base
      selectedRegionIndex = null;
      isDrawingMode = false;

      // Actualizar UI
      loadedSampleName.textContent = `✓ Cargado: ${sampleFileName}`;
      loadedSampleName.style.color = "#4CAF50";

      // Cargar configuración única (persistida o la plantilla por defecto)
      await loadPredefinedRegions(totalPages);
      presetIndicator.textContent = "Configuración base cargada";

      await renderPage();
    } catch (error) {
      console.error("Error cargando PDF:", error);
      alert("Error al cargar el PDF: " + error.message);
      loadedSampleName.textContent = "Error al cargar archivo";
      loadedSampleName.style.color = "#f44336";
    }
  });
}

// ============================================
// RENDERIZAR PÁGINA ACTUAL
// ============================================
async function renderPage() {
  if (!currentPdf) return;

  try {
    // Actualizar indicadores
    currentPageDisplay.textContent = currentPage;
    totalPagesDisplay.textContent = totalPages;
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages;

    // Obtener página
    const page = await currentPdf.getPage(currentPage);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });

    // Limpiar canvas
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Guardar dimensiones reales del PDF en puntos para conversión precisa
    const pageSize = page.getViewport({ scale: 1.0 });
    canvas.dataset.pdfWidthPt = pageSize.width;
    canvas.dataset.pdfHeightPt = pageSize.height;
    console.log(
      `Página ${currentPage}: ${pageSize.width}pt x ${pageSize.height}pt (${(
        pageSize.width / 2.83465
      ).toFixed(1)}mm x ${(pageSize.height / 2.83465).toFixed(1)}mm)`
    );

    // Renderizar PDF
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
    };

    await page.render(renderContext).promise;

    // Capturar imagen base (para restaurar sin múltiples previews)
    pageBaseImage[currentPage - 1] = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

    // Dibujar regiones
    drawAllRegions();
    updateRegionsList();
  } catch (error) {
    console.error("Error renderizando página:", error);
  }
}

// ============================================
// DIBUJAR TODAS LAS REGIONES DE LA PÁGINA
// ============================================
function drawAllRegions() {
  if (!canvas || !ctx) return;

  const pageKey = currentPage - 1;
  const regions = pageRegions[pageKey] || [];

  // Restaurar imagen base del PDF (sin regiones)
  if (pageBaseImage[pageKey]) {
    ctx.putImageData(pageBaseImage[pageKey], 0, 0);
  }

  // Dibujar regiones
  regions.forEach((region, index) => {
    drawRegionBox(region, index === selectedRegionIndex);
  });
}

// ============================================
// DIBUJAR UNA REGIÓN
// ============================================
function drawRegionBox(region, isActive) {
  if (!canvas || !ctx) return;

  // Usar la altura real del PDF para calcular la escala correcta
  const pdfHeightPt = parseFloat(canvas.dataset.pdfHeightPt) || 841.89; // A4 = 841.89pt
  const pdfHeightMm = pdfHeightPt / 2.83465; // Convertir puntos a mm
  const scale = canvas.height / pdfHeightMm; // Escala basada en altura real

  const pixelX = region.x * scale;
  const pixelY = region.y * scale;
  const pixelWidth = region.width * scale;
  const pixelHeight = region.height * scale;

  console.log(
    `Dibujando región: x=${region.x}mm (${pixelX.toFixed(1)}px), y=${
      region.y
    }mm (${pixelY.toFixed(1)}px), w=${region.width}mm (${pixelWidth.toFixed(
      1
    )}px), h=${region.height}mm (${pixelHeight.toFixed(1)}px), color=${
      region.color
    }`
  );

  // Dibujar preview del color de censura (color real que se aplicará)
  const censorColor = region.color || "#000000";
  ctx.fillStyle = isActive
    ? censorColor + "CC" // opaco si está seleccionado
    : censorColor + "99"; // semi-opaco si no está seleccionado
  ctx.fillRect(pixelX, pixelY, pixelWidth, pixelHeight);

  // Dibujar borde
  ctx.strokeStyle = isActive ? "#7a1c37" : "#9d2449";
  ctx.lineWidth = isActive ? 3 : 2;
  ctx.strokeRect(pixelX, pixelY, pixelWidth, pixelHeight);
}

// ============================================
// ACTUALIZAR LISTA DE REGIONES
// ============================================
function updateRegionsList() {
  const pageKey = currentPage - 1;
  const regions = pageRegions[pageKey] || [];

  if (regions.length === 0) {
    regionsList.innerHTML =
      '<p style="color: #999; font-size: 12px;">No hay regiones en esta página</p>';
    return;
  }

  regionsList.innerHTML = regions
    .map(
      (region, index) => `
    <div class="region-item">
      <div class="region-info">
        <strong>Región ${index + 1}</strong><br/>
        X: ${region.x.toFixed(1)}mm | Y: ${region.y.toFixed(1)}mm<br/>
        Ancho: ${region.width.toFixed(1)}mm | Alto: ${region.height.toFixed(
        1
      )}mm
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <input type="color" value="${region.color || "#000000"}" 
               onchange="updateRegionColor(${index}, this.value)"
               style="width: 40px; height: 32px; border: none; cursor: pointer;" />
        <button class="region-delete" onclick="deleteRegion(${index})">
          <i class="fas fa-trash"></i> Eliminar
        </button>
      </div>
    </div>
  `
    )
    .join("");
}

// ============================================
// ACTUALIZAR COLOR DE REGIÓN
// ============================================
function updateRegionColor(index, newColor) {
  const pageKey = currentPage - 1;
  if (pageRegions[pageKey] && pageRegions[pageKey][index]) {
    pageRegions[pageKey][index].color = newColor;
    drawAllRegions();
  }
}

// ============================================
// ELIMINAR UNA REGIÓN
// ============================================
window.deleteRegion = function (index) {
  const pageKey = currentPage - 1;

  if (!pageRegions[pageKey] || !pageRegions[pageKey][index]) {
    console.error("Región no encontrada");
    return;
  }

  pageRegions[pageKey].splice(index, 1);
  selectedRegionIndex = null;

  // Re-renderizar
  drawAllRegions();
  updateRegionsList();
};

// ============================================
// CARGAR REGIONES PREDEFINIDAS
// ============================================
async function fetchStoredConfig() {
  try {
    const resp = await fetch(
      `/api/config/load?name=${encodeURIComponent(DEFAULT_CONFIG_NAME)}`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data) return data;
  } catch (e) {
    console.warn("No se pudo cargar la configuración única:", e);
  }
  return null;
}

async function setActiveConfig() {
  try {
    const resp = await fetch("/api/config/set-active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetName: DEFAULT_CONFIG_NAME }),
    });
    const data = await resp.json();
    if (data && data.success) {
      activePresetName = DEFAULT_CONFIG_NAME;
      return true;
    }
  } catch (e) {
    console.warn("No se pudo establecer configuración activa:", e);
  }
  return false;
}

function buildDefaultConfig(total) {
  const config = {};
  for (let i = 0; i < total; i++) {
    config[i] = BASE_REGIONS_ALL_PAGES.map((r) => ({ ...r }));
    if (i === 1) {
      config[i] = config[i].concat(EXTRA_REGIONS_PAGE_2.map((r) => ({ ...r })));
    }
    if (i === 5) {
      config[i] = config[i].concat(EXTRA_REGIONS_PAGE_6.map((r) => ({ ...r })));
    }
  }
  return config;
}

// normalizeConfig ahora REEMPLAZA con la plantilla base, ignorando lo guardado
function normalizeConfig(total) {
  return buildDefaultConfig(total);
}

async function loadPredefinedRegions(total) {
  // Siempre cargar plantilla base limpia y sobrescribir el archivo guardado
  const base = buildDefaultConfig(total);
  try {
    await fetch("/api/config/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractName: DEFAULT_CONFIG_NAME,
        config: base,
      }),
    });
    await setActiveConfig();
    console.log("Configuración base restablecida y guardada");
  } catch (e) {
    console.warn("No se pudo persistir la configuración base:", e);
  }
  pageRegions = base;
  console.log("Configuración cargada:", pageRegions);
  drawAllRegions();
  updateRegionsList();
}

// ============================================
// BOTÓN: Cargar regiones predefinidas
// ============================================
if (loadPredefinedBtn) {
  loadPredefinedBtn.addEventListener("click", () => {
    if (!currentPdf) {
      alert("Por favor selecciona un contrato primero");
      return;
    }

    loadPredefinedRegions(totalPages);
    alert("Configuración base restablecida correctamente");
  });
}

// ============================================
// BOTÓN: Agregar región (modo dibujo)
// ============================================
if (addRegionBtn) {
  addRegionBtn.addEventListener("click", () => {
    if (!currentPdf) {
      alert("Por favor selecciona un contrato primero");
      return;
    }

    isDrawingMode = !isDrawingMode;

    if (isDrawingMode) {
      addRegionBtn.style.backgroundColor = "#2196f3";
      addRegionBtn.innerHTML = '<i class="fas fa-times"></i> Cancelar Dibujo';
      canvas.style.cursor = "crosshair";
    } else {
      addRegionBtn.style.backgroundColor = "";
      addRegionBtn.innerHTML =
        '<i class="fas fa-plus"></i> Agregar Región en Página Actual';
      canvas.style.cursor = "default";
      drawAllRegions(); // Redraw sin preview
    }
  });
}

// ============================================
// EVENTOS DE RATÓN PARA DIBUJAR/MOVER
// ============================================
canvas.addEventListener("mousedown", (e) => {
  if (!currentPdf) return;

  if (isDrawingMode) {
    drawStart = getCanvasCoords(e);
  } else {
    selectRegionAtPoint(e);
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (!currentPdf) return;

  if (isDrawingMode && drawStart) {
    const current = getCanvasCoords(e);

    // Re-renderizar sin preview
    drawAllRegions();

    // Mostrar preview de nueva región con el color seleccionado
    const width = current.x - drawStart.x;
    const height = current.y - drawStart.y;

    // Fill con color negro por defecto (opaco)
    ctx.fillStyle = "#000000CC"; // Negro con alta opacidad
    ctx.fillRect(drawStart.x, drawStart.y, width, height);

    // Borde punteado azul para indicar que es preview
    ctx.strokeStyle = "#2196f3";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(drawStart.x, drawStart.y, width, height);
    ctx.setLineDash([]);
  } else if (selectedRegionIndex !== null) {
    // Mover región con mouse
    const pageKey = currentPage - 1;
    if (!pageRegions[pageKey] || !pageRegions[pageKey][selectedRegionIndex])
      return;

    const region = pageRegions[pageKey][selectedRegionIndex];
    const scale = canvas.width / 210;

    const deltaX = e.movementX / scale;
    const deltaY = e.movementY / scale;

    region.x += deltaX;
    region.y += deltaY;

    drawAllRegions();
    updateRegionsList();
  }
});

canvas.addEventListener("mouseup", (e) => {
  // Caso 1: Terminamos de dibujar una región
  if (isDrawingMode && drawStart) {
    const current = getCanvasCoords(e);

    // Usar la misma escala que para dibujar (basada en altura real)
    const pdfHeightPt = parseFloat(canvas.dataset.pdfHeightPt) || 841.89;
    const pdfHeightMm = pdfHeightPt / 2.83465;
    const scale = canvas.height / pdfHeightMm;

    const minX = Math.min(drawStart.x, current.x);
    const minY = Math.min(drawStart.y, current.y);
    const width = Math.abs(current.x - drawStart.x);
    const height = Math.abs(current.y - drawStart.y);

    // Validar que la región sea significativa
    if (width > 5 && height > 5) {
      const newRegion = {
        x: minX / scale,
        y: minY / scale,
        width: width / scale,
        height: height / scale,
        color: "#000000",
      };

      const pageKey = currentPage - 1;
      if (!pageRegions[pageKey]) {
        pageRegions[pageKey] = [];
      }

      pageRegions[pageKey].push(newRegion);
    }

    // Salir del modo dibujo
    isDrawingMode = false;
    addRegionBtn.style.backgroundColor = "";
    addRegionBtn.innerHTML =
      '<i class="fas fa-plus"></i> Agregar Región en Página Actual';
    canvas.style.cursor = "default";
    drawStart = null;

    // Redibujar
    drawAllRegions();
    updateRegionsList();
  }

  // Caso 2: Terminamos de mover una región
  else if (selectedRegionIndex !== null && !isDrawingMode) {
    // Deseleccionar región después de soltar
    selectedRegionIndex = null;
    canvas.style.cursor = "default";
    drawAllRegions();
    updateRegionsList();
  }
});

// ============================================
// FUNCIONES AUXILIARES
// ============================================

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function selectRegionAtPoint(e) {
  const pageKey = currentPage - 1;
  const regions = pageRegions[pageKey] || [];
  const coords = getCanvasCoords(e);
  const scale = canvas.width / 210;

  // Buscar región desde la última hasta la primera (inverso)
  for (let i = regions.length - 1; i >= 0; i--) {
    const region = regions[i];
    const pixelX = region.x * scale;
    const pixelY = region.y * scale;
    const pixelWidth = region.width * scale;
    const pixelHeight = region.height * scale;

    if (
      coords.x >= pixelX &&
      coords.x <= pixelX + pixelWidth &&
      coords.y >= pixelY &&
      coords.y <= pixelY + pixelHeight
    ) {
      selectedRegionIndex = i;
      canvas.style.cursor = "move";
      drawAllRegions();
      updateRegionsList();
      return;
    }
  }

  selectedRegionIndex = null;
  canvas.style.cursor = "default";
  drawAllRegions();
  updateRegionsList();
}

// ============================================
// CONTROLES DE PÁGINA
// ============================================
if (prevPageBtn) {
  prevPageBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      selectedRegionIndex = null;
      renderPage();
    }
  });
}

if (nextPageBtn) {
  nextPageBtn.addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage++;
      selectedRegionIndex = null;
      renderPage();
    }
  });
}

// ============================================
// GUARDAR CONFIGURACIÓN
// ============================================
if (saveConfigBtn) {
  saveConfigBtn.addEventListener("click", async () => {
    if (!currentPdf) {
      alert("Por favor carga un contrato primero");
      return;
    }

    if (Object.keys(pageRegions).length === 0) {
      alert("No hay regiones definidas para guardar");
      return;
    }

    try {
      // Guardar configuración base
      const responseBase = await fetch("/api/config/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractName: DEFAULT_CONFIG_NAME,
          config: pageRegions,
        }),
      });

      const resultBase = await responseBase.json();

      if (!resultBase.success) {
        throw new Error(
          resultBase.error || "Error al guardar configuración base"
        );
      }

      // Si hay un archivo cargado, también guardar configuración individual
      let mensajeAdicional = "";
      if (sampleFileName) {
        const responseIndividual = await fetch("/api/config/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contractName: sampleFileName,
            config: pageRegions,
          }),
        });

        const resultIndividual = await responseIndividual.json();

        if (resultIndividual.success) {
          mensajeAdicional = `\n✅ También guardada configuración individual para: ${sampleFileName}`;
          console.log(
            `Configuración individual guardada para: ${sampleFileName}`
          );
        }
      }

      await setActiveConfig();
      alert(`✅ Configuración base guardada y activada${mensajeAdicional}`);
      console.log("Regiones guardadas:", pageRegions);
    } catch (error) {
      console.error("Error guardando configuración:", error);
      alert("❌ Error al guardar: " + error.message);
    }
  });
}

// ============================================
// INICIALIZAR APLICACIÓN
// ============================================
document.addEventListener("DOMContentLoaded", () => {
  console.log("Inicializando configuración de Testado...");
  // Ya no cargamos lista de contratos - usamos input file local
  // Asegurar que la configuración base quede activa y visible
  (async () => {
    await setActiveConfig();
    if (presetIndicator)
      presetIndicator.textContent = `Configuración base activa: ${DEFAULT_CONFIG_NAME}`;
  })();
});
