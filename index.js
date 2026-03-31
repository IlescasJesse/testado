const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");

// Función para convertir milímetros a puntos
function mmToPoints(mm) {
  return mm * 2.83465;
}

async function censorPdf(inputPath, outputPath, censorRegions) {
  console.log(`Testando el contrato de: ${inputPath}`);
  const existingPdfBytes = fs.readFileSync(inputPath);
  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  const pages = pdfDoc.getPages();

  pages.forEach((page, pageIndex) => {
    const { width, height } = page.getSize();
    const regions = censorRegions[pageIndex] || [];

    regions.forEach((region) => {
      page.drawRectangle({
        x: region.x,
        y: height - region.y - region.height,
        width: region.width,
        height: region.height,
        color: region.color,
      });
    });
  });

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);
  console.log(`Testados en : ${outputPath}`);
}

async function processAllPdfs(inputDir, outputDir, censorRegions) {
  const files = fs
    .readdirSync(inputDir)
    .filter(
      (file) =>
        file.toLowerCase().endsWith(".pdf") ||
        file.toLowerCase().endsWith(".pdf")
    );

  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    const outputPath = path.join(outputDir, file);
    await censorPdf(inputPath, outputPath, censorRegions);
  }

  console.log(`Todos los contratos se guardaron en: ${outputDir}`);
}

const inputDir = "./contratos";
const outputDir = "./tested_Censurado"; // Ensure this path is correct
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Función para convertir colores hexadecimales a rgb
function hexToRgb(hex) {
  const bigint = parseInt(hex.slice(1), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return rgb(r / 255, g / 255, b / 255);
}

const censorRegions = {
  1: [
    {
      x: mmToPoints(130.82),
      y: mmToPoints(92.34),
      width: mmToPoints(31.71),
      height: mmToPoints(4),
      color: hexToRgb("#000000"), // Negro
    }, // Página 2
  ],
  5: [
    {
      x: mmToPoints(123.3),
      y: mmToPoints(80.73), // Subir 4 mm
      width: mmToPoints(40),
      height: mmToPoints(17),
      color: hexToRgb("#000000"), // Negro
    }, // Página 6
  ],
  7: [
    {
      x: mmToPoints(132.82),
      y: mmToPoints(72.34),
      width: mmToPoints(31.71),
      height: mmToPoints(4),
      color: hexToRgb("#000000"), // Negro
    }, // Página 8 (duplicado de la página 2)
  ],
  11: [
    {
      x: mmToPoints(123.3),
      y: mmToPoints(76.73) + mmToPoints(4), // Subir 4 mm
      width: mmToPoints(40),
      height: mmToPoints(17),
      color: hexToRgb("#000000"), // Negro
    }, // Página 12 (duplicado de la página 6)
  ],
};

// Añadir censura en blanco a los lados para todas las páginas
for (let i = 0; i < 12; i++) {
  if (!censorRegions[i]) {
    censorRegions[i] = [];
  }
  censorRegions[i].push(
    {
      x: mmToPoints(0.4),
      y: mmToPoints(15.0) + mmToPoints(4), // Subir 4 mm
      width: mmToPoints(15.8), // Aumentar ancho en 4 mm
      height: mmToPoints(269),
      color: hexToRgb("#FFFFFF"), // Blanco
    },
    {
      x: mmToPoints(195.66),
      y: mmToPoints(15.0) + mmToPoints(4), // Subir 4 mm
      width: mmToPoints(16) + mmToPoints(4), // Aumentar ancho en 4 mm
      height: mmToPoints(269),
      color: hexToRgb("#FFFFFF"), // Blanco
    }
  );
}

// Solo ejecutar si se llama directamente (no desde Electron)
if (require.main === module) {
  processAllPdfs(inputDir, outputDir, censorRegions);
}

// Exportar funciones para Electron
module.exports = {
  censorPdf,
  processAllPdfs,
  hexToRgb,
  mmToPoints,
};
