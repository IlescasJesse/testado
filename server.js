const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const { spawnSync } = require("child_process");
const tesseract = require("node-tesseract-ocr");
const poppler = require("pdf-poppler");
const { createCanvas, loadImage } = require("canvas");

const app = express();
const PORT = 3001;
const HOST = "0.0.0.0";

// Array para almacenar archivos procesados
let processedFiles = [];

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Configuración de directorios
const directories = [
  path.join(__dirname, "contratos"),
  path.join(__dirname, "tested_Censurado"),
  path.join(__dirname, "temp_uploads"),
  path.join(__dirname, "config"),
  path.join(__dirname, "build"),
];

directories.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configuración de Multer para cargar múltiples PDFs
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === ".pdf") {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos PDF"));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB por archivo
    files: 1000, // Máximo 1000 archivos
  },
});

// Función para detectar RFC usando OCR y testar en imagen
async function detectarYTestarRFCEnImagen(pdfBytes, pageIndex = 1) {
  let tempPdfPath = null;
  let imgPath = null;

  try {
    tempPdfPath = path.join(
      __dirname,
      "temp_uploads",
      `temp_${Date.now()}_${Math.random()}.pdf`
    );
    fs.writeFileSync(tempPdfPath, pdfBytes);

    const opts = {
      format: "png",
      out_dir: path.join(__dirname, "temp_uploads"),
      out_prefix: `ocr_${Date.now()}_${Math.random()}`,
      page: pageIndex + 1,
      scale: 2048,
    };

    await poppler.convert(tempPdfPath, opts);

    const outputName = `${opts.out_prefix}-${opts.page}.png`;
    imgPath = path.join(opts.out_dir, outputName);

    if (fs.existsSync(imgPath)) {
      const config = {
        lang: "spa",
        oem: 1,
        psm: 3,
      };

      const text = await tesseract.recognize(imgPath, config);

      const { execSync } = require("child_process");
      const tsvPath = imgPath.replace(".png", ".tsv");
      execSync(
        `tesseract "${imgPath}" "${tsvPath.replace(
          ".tsv",
          ""
        )}" -l spa --oem 1 --psm 3 tsv`,
        { encoding: "utf8" }
      );
      const tsv = fs.readFileSync(tsvPath, "utf8");

      const cleanedOCRText = text.toUpperCase();
      const lines = tsv.split("\n");
      const words = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        if (cols.length < 12) continue;
        const wordText = cols[11]?.trim() || "";
        const left = parseInt(cols[6]);
        const top = parseInt(cols[7]);
        const w = parseInt(cols[8]);
        const h = parseInt(cols[9]);
        if (!wordText || isNaN(left) || isNaN(top) || isNaN(w) || isNaN(h)) continue;
        words.push({
          text: wordText,
          left,
          top,
          w,
          h,
          right: left + w,
          bottom: top + h,
        });
      }

      let rfc = null;
      const rfcCandidates = [];

      // Intento directo de patrones RFC comunes
      const rfcPatterns = [
        /(?:RFC|R\.F\.C\.|N[UÚ]MERO(?:\s+DE)?\s+RFC|N[UÚ]MERO\s*:\s*RFC)\s*[:\-]?\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3})/i,
        /(?:N[UÚ]MERO\s*:\s*)([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3})/i,
        /([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3})/i,
      ];

      for (const pat of rfcPatterns) {
        const match = cleanedOCRText.match(pat);
        if (match && match[1]) {
          const candidate = match[1].replace(/[^A-Z0-9Ñ&]/g, "").toUpperCase();
          if (candidate.length === 12 || candidate.length === 13) {
            rfc = candidate;
            break;
          }
        }
      }

      // Extraer candidatos RFC de las palabras del TSV
      const candidateRegexp = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3}$/;
      for (const w of words) {
        const cleaned = w.text.toUpperCase().replace(/[^A-Z0-9Ñ&]/g, "");
        if (candidateRegexp.test(cleaned)) {
          rfcCandidates.push({ value: cleaned, word: w });
        }
      }

      if (!rfc && rfcCandidates.length > 0) {
        rfc = rfcCandidates[0].value;
      }

      const image = await loadImage(imgPath);
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);

      let rfcFound = false;
      let minX = Infinity,
        minY = Infinity,
        maxX = 0,
        maxY = 0;

          // Buscar RFC completo
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split("\t");
            if (cols.length < 12) continue;

            const rawText = cols[11]?.trim() || "";
            const text = rawText.toUpperCase().replace(/[^A-Z0-9]/g, "");
            const left = parseInt(cols[6]);
            const top = parseInt(cols[7]);
            const w = parseInt(cols[8]);
            const h = parseInt(cols[9]);

            if (!text || isNaN(left) || isNaN(top)) continue;

            if (text === rfc) {
              minX = left;
              minY = top;
              maxX = left + w;
              maxY = top + h;
              rfcFound = true;
              break;
            }
          }

          // Buscar fragmentos si no se encontró completo
          if (!rfcFound) {
            for (let i = 1; i < lines.length; i++) {
              const cols = lines[i].split("\t");
              if (cols.length < 12) continue;

              const rawText = cols[11]?.trim() || "";
              const text = rawText.toUpperCase().replace(/[^A-Z0-9]/g, "");
              const left = parseInt(cols[6]);
              const top = parseInt(cols[7]);
              const w = parseInt(cols[8]);
              const h = parseInt(cols[9]);

              if (!text || isNaN(left) || isNaN(top)) continue;

              if (rfc && text.length >= 8 && rfc.includes(text)) {
                minX = Math.min(minX, left);
                minY = Math.min(minY, top);
                maxX = Math.max(maxX, left + w);
                maxY = Math.max(maxY, top + h);
                rfcFound = true;
              }
            }
          }

          const { registerFont } = require("canvas");
          registerFont(
            path.join(__dirname, "fonts", "Montserrat-Regular.ttf"),
            { family: "Montserrat" }
          );

          let x, y, width, height;

          if (rfcFound && minX < Infinity) {
            x = minX;
            y = minY;
            width = maxX - minX;
            height = maxY - minY;
          } else {
            // Fallback: buscar "b)" y "número"
            let fallbackY = 690;
            let fallbackX = 970;

            for (let i = 1; i < lines.length; i++) {
              const cols = lines[i].split("\t");
              if (cols.length < 12) continue;
              const text = cols[11]?.trim().toLowerCase() || "";

              if (text.includes("b)")) {
                for (let j = i; j < Math.min(i + 20, lines.length); j++) {
                  const cols2 = lines[j].split("\t");
                  if (cols2.length < 12) continue;
                  const text2 = cols2[11]?.trim().toLowerCase() || "";

                  if (text2.includes("número") && !text2.includes("edificio")) {
                    fallbackY = parseInt(cols2[7]) || fallbackY;
                    fallbackX =
                      parseInt(cols2[6]) + parseInt(cols2[8]) + 50 || fallbackX;
                    break;
                  }
                }
                break;
              }
            }

            x = fallbackX - 10;
            y = fallbackY - 8;
            width = 240;
            height = 38;
          }

          // SIEMPRE dibujar rectángulo
          ctx.fillStyle = "#000000";
          ctx.fillRect(
            x,
            y,
            width + (rfcFound ? 25 : 0),
            height + (rfcFound ? 16 : 0)
          );

          ctx.fillStyle = "#FFFFFF";
          ctx.font = "bold 38px Montserrat";
          ctx.textAlign = "center";
          ctx.fillText("1. RFC", x + width / 2, y + height / 2 + 18);

          if (rfc) {
            console.log(`✅ RFC detectado y testado: ${rfc}`);
          } else {
            console.log('⚠ No se detectó RFC (fallback), se dibujó región de prueba');
          }

          const testedImgPath = path.join(
            opts.out_dir,
            `tested_${Date.now()}_${Math.random()}.png`
          );
          const buffer = canvas.toBuffer("image/png");
          fs.writeFileSync(testedImgPath, buffer);

          if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
          if (fs.existsSync(tsvPath)) fs.unlinkSync(tsvPath);

          return { rfc, testedImagePath: testedImgPath };
    }

    return null;
  } catch (error) {
    console.log(`⚠ OCR Error: ${error.message}`);
    return null;
  } finally {
    if (tempPdfPath && fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
  }
}

// Función para detectar y censurar "EL PRESTADOR DE SERVICIOS" en página 6 usando OCR.
// Coloca un rectángulo blanco de 7 cm de alto × ancho de la cadena detectada, justo debajo del texto.
async function detectarYCensurarPrestadorPagina6(pdfBytes, pdfDoc) {
  let tempPdfPath = null;
  let imgPath = null;
  let tsvPath = null;

  const pageIndex = 5; // Página 6 del contrato (0-based)
  const currentPages = pdfDoc.getPages();
  if (currentPages.length <= pageIndex) {
    console.log("⚠ El PDF no tiene página 6, omitiendo censura de PRESTADOR");
    return;
  }

  const targetPage = currentPages[pageIndex];
  const { width: pdfW, height: pdfH } = targetPage.getSize();

  try {
    const outPrefix = `ocr_p6_${Date.now()}`;
    tempPdfPath = path.join(__dirname, "temp_uploads", `${outPrefix}.pdf`);
    fs.writeFileSync(tempPdfPath, pdfBytes);

    const opts = {
      format: "png",
      out_dir: path.join(__dirname, "temp_uploads"),
      out_prefix: outPrefix,
      page: pageIndex + 1,
      scale: 2048,
    };

    await poppler.convert(tempPdfPath, opts);
    imgPath = path.join(opts.out_dir, `${outPrefix}-${pageIndex + 1}.png`);

    if (!fs.existsSync(imgPath)) {
      console.log("⚠ No se pudo generar imagen de página 6 para detectar PRESTADOR");
      return;
    }

    const { execSync } = require("child_process");
    tsvPath = imgPath.replace(".png", ".tsv");
    execSync(
      `tesseract "${imgPath}" "${tsvPath.replace(".tsv", "")}" -l spa --oem 1 --psm 3 tsv`,
      { encoding: "utf8" }
    );
    const tsv = fs.readFileSync(tsvPath, "utf8");

    const image = await loadImage(imgPath);
    const imgW = image.width;
    const imgH = image.height;

    // Factores de escala: píxeles de imagen → puntos PDF
    const scX = pdfW / imgW;
    const scY = pdfH / imgH;

    // Parsear palabras del TSV
    const words = [];
    for (const line of tsv.split("\n").slice(1)) {
      const cols = line.split("\t");
      if (cols.length < 12) continue;
      const text = cols[11]?.trim() || "";
      const left = parseInt(cols[6]);
      const top  = parseInt(cols[7]);
      const w    = parseInt(cols[8]);
      const h    = parseInt(cols[9]);
      if (!text || isNaN(left) || isNaN(top) || isNaN(w) || isNaN(h) || w <= 0 || h <= 0) continue;
      words.push({ text, left, top, right: left + w, bottom: top + h, h });
    }

    // Buscar "PRESTADOR" como ancla, excluyendo el pie de página (>75 % de alto)
    const anchor = words.find(
      (w) => w.text.toUpperCase().includes("PRESTADOR") && w.top < imgH * 0.75
    );

    if (!anchor) {
      console.log("⚠ No se encontró 'PRESTADOR' en página 6, omitiendo censura");
      return;
    }

    // Expandir bounding box a toda la frase "EL PRESTADOR DE SERVICIOS"
    // Solo se consideran palabras en la misma línea (±1.5× altura del ancla)
    // y que sean parte estricta de la etiqueta (no palabras genéricas que contaminen el ancho).
    const FRASE_TOKENS = new Set(["PRESTADOR", "DE", "SERVICIOS", "SERVICIO", "EL", "LOS", "DEL"]);
    const lineThreshold = anchor.h * 1.5;

    let minX = anchor.left;
    let maxX = anchor.right;
    let minY = anchor.top;
    let maxY = anchor.bottom;

    for (const w of words) {
      if (Math.abs(w.top - anchor.top) > lineThreshold) continue;
      const token = w.text.toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ]/g, "");
      if (FRASE_TOKENS.has(token)) {
        minX = Math.min(minX, w.left);
        maxX = Math.max(maxX, w.right);
        minY = Math.min(minY, w.top);
        maxY = Math.max(maxY, w.bottom);
      }
    }

    // ── Coordenadas PDF del borde inferior del texto ──────────────────────────
    // En imagen:  Y crece hacia abajo  → maxY es el borde visual inferior del texto
    // En PDF:     Y crece hacia arriba → borde inferior del texto = pdfH - maxY*scY
    const pdfTextX      = minX * scX;
    const pdfTextW      = (maxX - minX) * scX;
    const pdfTextBottom = pdfH - maxY * scY; // coordenada Y (PDF) del borde inferior del texto

    // Rectángulo blanco debajo de la etiqueta:
    //   · Alto  = 7 cm  (≈ 198.4 pt)
    //   · Ancho = ancho real de la cadena de texto detectada
    const rectH = 7 * 28.3465; // 7 cm en puntos PDF

    // En PDF el parámetro `y` de drawRectangle es la esquina inferior-izquierda.
    // El rectángulo empieza visualmente en pdfTextBottom y se extiende 7 cm hacia abajo.
    const rectX = Math.max(0, pdfTextX);
    const rectY = Math.max(0, pdfTextBottom - rectH);
    const rectW = Math.min(pdfW - rectX, pdfTextW);

    targetPage.drawRectangle({ x: rectX, y: rectY, width: rectW, height: rectH, color: rgb(0, 0, 0) });

    console.log(
      `✅ Pág. 6: rectángulo blanco (7 cm × ${(pdfTextW / 28.3465).toFixed(1)} cm) bajo "EL PRESTADOR DE SERVICIOS"`
    );
  } catch (error) {
    console.log(`⚠ OCR PRESTADOR página 6: ${error.message}`);
  } finally {
    if (tempPdfPath && fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
    if (imgPath    && fs.existsSync(imgPath))    fs.unlinkSync(imgPath);
    if (tsvPath    && fs.existsSync(tsvPath))    fs.unlinkSync(tsvPath);
  }
}

// Función para censurar firmas/rúbricas laterales en todas las páginas
async function censurarFirmasLaterales(pdfDoc, font) {
  const currentPages = pdfDoc.getPages();
  for (const page of currentPages) {
    const { width, height } = page.getSize();
    // Ancho de la franja lateral a censurar (~7.5% del ancho de página)
    // Ajustar este valor si las rúbricas están más adentro o más afuera
    const lateralW = width * 0.075;

    // Franjas blancas (color blanco) para cubrir rúbricas laterales
    page.drawRectangle({ x: 0, y: 0, width: lateralW, height, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: width - lateralW, y: 0, width: lateralW, height, color: rgb(1, 1, 1) });
  }
}

// Función para detectar y censurar firma autógrafa en la última página usando OCR
async function detectarYCensurarFirmaUltimaPagina(pdfBytes, pdfDoc, font) {
  let tempPdfPath = null;
  let imgPath = null;
  let tsvPath = null;

  const currentPages = pdfDoc.getPages();
  const lastPageIndex = currentPages.length - 1;
  const lastPage = currentPages[lastPageIndex];
  const { width: pdfW, height: pdfH } = lastPage.getSize();

  try {
    tempPdfPath = path.join(
      __dirname,
      "temp_uploads",
      `temp_firma_${Date.now()}_${Math.random()}.pdf`
    );
    fs.writeFileSync(tempPdfPath, pdfBytes);

    const opts = {
      format: "png",
      out_dir: path.join(__dirname, "temp_uploads"),
      out_prefix: `ocr_firma_${Date.now()}_${Math.random()}`,
      page: lastPageIndex + 1,
      scale: 2048,
    };

    await poppler.convert(tempPdfPath, opts);

    const outputName = `${opts.out_prefix}-${opts.page}.png`;
    imgPath = path.join(opts.out_dir, outputName);

    if (!fs.existsSync(imgPath)) {
      aplicarFallbackFirmaUltimaPagina(lastPage, pdfW, pdfH, font);
      return;
    }

    const { execSync } = require("child_process");
    tsvPath = imgPath.replace(".png", ".tsv");
    execSync(
      `tesseract "${imgPath}" "${tsvPath.replace(".tsv", "")}" -l spa --oem 1 --psm 3 tsv`,
      { encoding: "utf8" }
    );
    const tsv = fs.readFileSync(tsvPath, "utf8");

    const image = await loadImage(imgPath);
    const imgW = image.width;
    const imgH = image.height;

    // Factores de conversión píxeles de imagen → puntos PDF
    const scX = pdfW / imgW;
    const scY = pdfH / imgH;

    const lines = tsv.split("\n");

    // Buscar "PRESTADOR" como texto ancla de la zona de firma
    let anchorImgY = null;
    let anchorImgX = null;
    let anchorImgH = 40;
    let anchorImgW = 400;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      if (cols.length < 12) continue;
      const text = cols[11]?.trim().toUpperCase() || "";
      const left = parseInt(cols[6]);
      const top = parseInt(cols[7]);
      const w = parseInt(cols[8]);
      const h = parseInt(cols[9]);

      // Filtrar por posición: el encabezado "EL PRESTADOR DE SERVICIOS" está en la
      // mitad derecha de la página y en el 70% superior. El aviso de privacidad
      // al pie contiene "Prestadoras de Servicios" pero está en la parte inferior
      // e izquierda — esos matches se ignoran.
      const enMitadDerecha = !isNaN(left) && left > imgW * 0.10;
      const enMitadSuperior = !isNaN(top) && top < imgH * 0.70;
      if ((text.includes("PRESTADOR") || text.includes("SERVICIOS")) && enMitadDerecha && enMitadSuperior) {
        anchorImgY = top;
        anchorImgX = left;
        if (!isNaN(h)) anchorImgH = h;
        if (!isNaN(w)) anchorImgW = w;
        break;
      }
    }

    if (anchorImgY !== null) {
      // La firma está DEBAJO del ancla "EL PRESTADOR DE SERVICIOS"
      // Layout: [ancla] → [firma autógrafa] → [nombre del empleado]
      // Cubrimos desde el ancla hasta el final del nombre con un solo rectángulo blanco

      // Buscar hasta dónde llega el nombre del empleado (texto debajo del ancla, max 450px)
      let bloqueImgYFin = anchorImgY + anchorImgH + 300; // fallback
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        if (cols.length < 12) continue;
        const rowTop = parseInt(cols[7]);
        const rowH = parseInt(cols[9]);
        const rowText = cols[11]?.trim() || "";
        if (!isNaN(rowTop) && rowTop > anchorImgY + anchorImgH && rowTop < anchorImgY + anchorImgH + 450 && rowText.length > 1) {
          bloqueImgYFin = Math.max(bloqueImgYFin, rowTop + (isNaN(rowH) ? 30 : rowH));
        }
      }

      // Rectángulo que cubre: ancla + firma + nombre
      const bloqueImgY = Math.max(0, anchorImgY - 10);
      const bloqueImgH = bloqueImgYFin - bloqueImgY + 30;
      const bloqueImgX = Math.max(0, anchorImgX - 120);
      const bloqueImgW = Math.min(imgW - bloqueImgX, anchorImgW + 500);

      const pdfBloqueX = bloqueImgX * scX;
      const pdfBloqueY = pdfH - (bloqueImgY + bloqueImgH) * scY;
      const pdfBloqueW = bloqueImgW * scX;
      const pdfBloqueH = bloqueImgH * scY;

      lastPage.drawRectangle({
        x: Math.max(0, pdfBloqueX),
        y: Math.max(0, pdfBloqueY),
        width: Math.min(pdfW - pdfBloqueX, pdfBloqueW),
        height: pdfBloqueH,
        color: rgb(0, 0, 0),
      });
    } else {
      console.log("⚠ No se encontró 'PRESTADOR' en última página, usando fallback");
      aplicarFallbackFirmaUltimaPagina(lastPage, pdfW, pdfH, font);
    }
  } catch (error) {
    console.log(`⚠ OCR Firma última página: ${error.message}`);
    aplicarFallbackFirmaUltimaPagina(lastPage, pdfW, pdfH, font);
  } finally {
    if (tempPdfPath && fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
    if (imgPath && fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    if (tsvPath && fs.existsSync(tsvPath)) fs.unlinkSync(tsvPath);
  }
}

// Fallback: cubre la zona donde aparece la firma del prestador de servicios
// La sección "EL PRESTADOR DE SERVICIOS" + firma autógrafa + nombre ocupa aprox 30–58% desde arriba
function aplicarFallbackFirmaUltimaPagina(page, pdfW, pdfH, font) {
  // En PDF: Y crece hacia arriba. La firma está al 30–58% desde arriba → 42–70% desde abajo.
  const x = pdfW * 0.15;   // empieza al 15% desde la izquierda
  const y = pdfH * 0.42;   // borde inferior del rect = 42% desde abajo (58% desde arriba)
  const w = pdfW * 0.75;   // 75% de ancho (hasta el 90% desde la izquierda)
  const h = pdfH * 0.30;   // 30% de alto → borde superior en 72% desde abajo (28% desde arriba)

  // Rectángulo negro (censura sin OCR)
  page.drawRectangle({ x, y, width: w, height: h, color: rgb(0, 0, 0) });
}

// Detectar y censurar el nombre del prestador de servicios en página 2 usando OCR.
// Busca el texto ancla "PRESTADOR" y luego censura el nombre que aparece justo
// después (mismo renglón) o en el renglón inmediatamente inferior.
async function detectarYCensurarNombrePrestador(pdfBytes, pdfDoc) {
  let tempPdfPath = null;
  let imgPath = null;
  let tsvPath = null;

  const pageIndex = 1; // Página 2 del contrato (0-based)
  const currentPages = pdfDoc.getPages();
  if (currentPages.length <= pageIndex) return;

  const targetPage = currentPages[pageIndex];
  const { width: pdfW, height: pdfH } = targetPage.getSize();

  try {
    tempPdfPath = path.join(
      __dirname,
      "temp_uploads",
      `temp_nombre_${Date.now()}_${Math.random()}.pdf`
    );
    fs.writeFileSync(tempPdfPath, pdfBytes);

    const opts = {
      format: "png",
      out_dir: path.join(__dirname, "temp_uploads"),
      out_prefix: `ocr_nombre_${Date.now()}_${Math.random()}`,
      page: pageIndex + 1,
      scale: 2048,
    };

    await poppler.convert(tempPdfPath, opts);

    const outputName = `${opts.out_prefix}-${opts.page}.png`;
    imgPath = path.join(opts.out_dir, outputName);

    if (!fs.existsSync(imgPath)) {
      console.log("⚠ No se pudo generar imagen para detectar nombre del prestador");
      return;
    }

    const { execSync } = require("child_process");
    tsvPath = imgPath.replace(".png", ".tsv");
    execSync(
      `tesseract "${imgPath}" "${tsvPath.replace(".tsv", "")}" -l spa --oem 1 --psm 3 tsv`,
      { encoding: "utf8" }
    );
    const tsv = fs.readFileSync(tsvPath, "utf8");

    const image = await loadImage(imgPath);
    const imgW = image.width;
    const imgH = image.height;

    // Factores de conversión píxeles de imagen → puntos PDF
    const scX = pdfW / imgW;
    const scY = pdfH / imgH;

    // Parsear todas las palabras del TSV
    const tsvLines = tsv.split("\n");
    const words = [];
    for (let i = 1; i < tsvLines.length; i++) {
      const cols = tsvLines[i].split("\t");
      if (cols.length < 12) continue;
      const wordText = cols[11]?.trim() || "";
      const left = parseInt(cols[6]);
      const top = parseInt(cols[7]);
      const w = parseInt(cols[8]);
      const h = parseInt(cols[9]);
      if (!wordText || isNaN(left) || isNaN(top) || isNaN(w) || isNaN(h)) continue;
      words.push({ text: wordText, left, top, w, h, right: left + w, bottom: top + h });
    }

    // Buscar la palabra ancla "PRESTADOR" en la parte superior de la página
    // (se excluye la zona inferior > 75% para no colisionar con el bloque de firma)
    let anchorWord = null;
    for (const word of words) {
      if (word.text.toUpperCase().includes("PRESTADOR") && word.top < imgH * 0.75) {
        anchorWord = word;
        break;
      }
    }

    if (!anchorWord) {
      console.log("⚠ No se encontró 'PRESTADOR' en página 2, omitiendo censura de nombre");
      return;
    }

    const anchorLine = anchorWord.top;
    const lineH = anchorWord.h || 30;
    const lineThreshold = lineH * 1.2;

    // Determinar el extremo derecho de la etiqueta completa
    // ("PRESTADOR DE SERVICIOS:", "EL PRESTADOR DE SERVICIOS", etc.)
    const LABEL_WORDS = new Set(["PRESTADOR", "DE", "SERVICIOS", "SERVICIO", "EL", "LOS", "DEL", "LA"]);
    let labelEndX = anchorWord.right;

    for (const word of words) {
      if (Math.abs(word.top - anchorLine) > lineThreshold) continue;
      if (word.left < anchorWord.left) continue;
      const wordUp = word.text.toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ]/g, "");
      if (LABEL_WORDS.has(wordUp) || word.text.includes(":")) {
        labelEndX = Math.max(labelEndX, word.right);
      }
    }

    // Recopilar el nombre: palabras en el mismo renglón DESPUÉS del final de la etiqueta
    let nameWords = words.filter(
      (w) =>
        Math.abs(w.top - anchorLine) <= lineThreshold &&
        w.left > labelEndX + 5
    );

    // Si no hay texto en el mismo renglón, buscar en el renglón inmediatamente inferior
    if (nameWords.length === 0) {
      const nextLineYMin = anchorLine + lineH * 0.5;
      const nextLineYMax = anchorLine + lineH * 3.5;
      nameWords = words.filter(
        (w) =>
          w.top > nextLineYMin &&
          w.top < nextLineYMax &&
          w.left >= anchorWord.left - 60
      );
    }

    if (nameWords.length === 0) {
      console.log("⚠ No se encontró nombre después de 'PRESTADOR' en página 2");
      return;
    }

    // Calcular bounding box del nombre
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    for (const w of nameWords) {
      if (w.left < minX) minX = w.left;
      if (w.top < minY) minY = w.top;
      if (w.right > maxX) maxX = w.right;
      if (w.bottom > maxY) maxY = w.bottom;
    }

    const pad = 8;
    const pdfRectX = Math.max(0, (minX - pad) * scX);
    const pdfRectY = Math.max(0, pdfH - (maxY + pad) * scY);
    const pdfRectW = Math.min(pdfW - pdfRectX, (maxX - minX + pad * 2) * scX);
    const pdfRectH = (maxY - minY + pad * 2) * scY;

    targetPage.drawRectangle({
      x: pdfRectX,
      y: pdfRectY,
      width: pdfRectW,
      height: pdfRectH,
      color: rgb(0, 0, 0),
    });

    console.log(
      `✅ Nombre del prestador censurado: "${nameWords.map((w) => w.text).join(" ")}"`
    );
  } catch (error) {
    console.log(`⚠ OCR Nombre Prestador: ${error.message}`);
  } finally {
    if (tempPdfPath && fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
    if (imgPath && fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    if (tsvPath && fs.existsSync(tsvPath)) fs.unlinkSync(tsvPath);
  }
}

// Función para censurar PDF
async function censorPdf(inputBytes, outputPath, filename) {
  const pdfDoc = await PDFDocument.load(inputBytes);
  const pages = pdfDoc.getPages();

  // Cargar fuente Montserrat una sola vez para reutilizar en todo el procesamiento
  pdfDoc.registerFontkit(fontkit);
  const montserratBytes = fs.readFileSync(
    path.join(__dirname, "fonts", "Montserrat-Regular.ttf")
  );
  const montserratFont = await pdfDoc.embedFont(montserratBytes);

  // Detectar RFC en página 2
  const rfcDetectado = await detectarYTestarRFCEnImagen(inputBytes, 1);

  if (
    rfcDetectado?.testedImagePath &&
    fs.existsSync(rfcDetectado.testedImagePath)
  ) {
    const page2 = pages[1];
    const { width, height } = page2.getSize();

    const imgBuffer = fs.readFileSync(rfcDetectado.testedImagePath);
    const pngImage = await pdfDoc.embedPng(imgBuffer);

    page2.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: width,
      height: height,
      opacity: 1.0,
    });

    fs.unlinkSync(rfcDetectado.testedImagePath);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REDIMENSIONADO DE PÁGINA 2 (índice 1) AL 71%
  // ─────────────────────────────────────────────────────────────────────────
  // Se comprime el contenido de la página 2 al 71% de su tamaño original
  // para liberar espacio en la parte inferior donde se inserta la leyenda legal
  // de versión pública, conforme al Art. 65 fracción X de la Ley de Transparencia.
  //
  // Flujo:
  //   1. scaleContent(0.71, 0.71) — escala texto e imágenes al 71%
  //   2. translateContent(offsetX, offsetY) — centra horizontalmente y
  //      desplaza hacia arriba dejando 15pt de margen superior
  //   3. Se re-inserta la página modificada (removePage + insertPage)
  //      para que los cambios de escala queden persistidos en el documento
  //   4. Se dibuja la leyenda legal en el espacio liberado al pie de página
  // ─────────────────────────────────────────────────────────────────────────
  // Página 2 sin modificar — solo se aplican las barras laterales (censurarFirmasLaterales)
  // if (pages.length >= 2) { ... }

  // Censurar firmas/rúbricas laterales en todas las páginas
  await censurarFirmasLaterales(pdfDoc, montserratFont);

  // Censurar nombre del prestador en página 2 (OCR: busca "PRESTADOR" y censura el nombre que sigue)
  await detectarYCensurarNombrePrestador(inputBytes, pdfDoc);

  // Detectar y censurar "EL PRESTADOR DE SERVICIOS" en página 6 (coloca rectángulo blanco 7cm×10cm debajo)
  await detectarYCensurarPrestadorPagina6(inputBytes, pdfDoc);

  // Censurar firma autógrafa en la última página (ancla: "PRESTADOR DE SERVICIOS")
  await detectarYCensurarFirmaUltimaPagina(inputBytes, pdfDoc, montserratFont);

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);

  // Encriptar con qpdf si está disponible
  try {
    const r = spawnSync("qpdf", ["--version"], { stdio: "pipe" });
    if (r.status === 0) {
      const tmpPath = `${outputPath}.enc`;
      const args = [
        "--encrypt",
        "",
        "F1N4NZ4S2025",
        "256",
        "--modify=none",
        "--print=full",
        "--",
        outputPath,
        tmpPath,
      ];
      const res = spawnSync("qpdf", args, { stdio: "pipe" });
      if (res.status === 0) {
        fs.renameSync(tmpPath, outputPath);
      }
    }
  } catch (err) {
    // Ignorar si qpdf no está disponible
  }

  // Renombrar a mayúsculas
  const dir = path.dirname(outputPath);
  const basename = path.basename(outputPath);
  const uppercaseFilename = basename.toUpperCase();

  if (basename !== uppercaseFilename) {
    const newPath = path.join(dir, uppercaseFilename);
    fs.renameSync(outputPath, newPath);
    return uppercaseFilename;
  }

  return basename;
}

// RUTAS

// Ruta principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Ruta para procesar múltiples PDFs
app.post("/api/process", upload.array("pdfs", 1000), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No se recibieron archivos",
      });
    }

    const totalFiles = req.files.length;

    // Responder inmediatamente
    res.json({
      success: true,
      message: `Procesando ${totalFiles} archivos en segundo plano...`,
      totalFiles: totalFiles,
      processing: true,
      timestamp: new Date().toISOString(),
    });

    // Procesar en segundo plano
    setImmediate(async () => {
      const startTime = Date.now();
      const outputDir = path.join(__dirname, "tested_Censurado");

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const startFileTime = Date.now();

        try {
          const outputPath = path.join(outputDir, file.originalname);
          const finalFilename = await censorPdf(
            file.buffer,
            outputPath,
            file.originalname
          );

          const fileData = {
            id: Date.now() + Math.random() + i,
            filename: file.originalname,
            finalFilename: finalFilename,
            size: file.size,
            uploadDate: new Date().toISOString(),
            processingTime: Date.now() - startFileTime,
            success: true,
          };

          processedFiles.push(fileData);
          console.log(
            `✅ [${i + 1}/${totalFiles}] ${finalFilename} (${
              Date.now() - startFileTime
            }ms)`
          );
        } catch (error) {
          // Guardar archivo con error para reprocesar
          const errorDir = path.join(__dirname, "temp_uploads", "errors");
          if (!fs.existsSync(errorDir)) {
            fs.mkdirSync(errorDir, { recursive: true });
          }
          const errorPath = path.join(errorDir, file.originalname);
          fs.writeFileSync(errorPath, file.buffer);

          const fileData = {
            id: Date.now() + Math.random() + i,
            filename: file.originalname,
            size: file.size,
            uploadDate: new Date().toISOString(),
            processingTime: Date.now() - startFileTime,
            success: false,
            error: error.message,
          };

          processedFiles.push(fileData);
          console.log(
            `❌ [${i + 1}/${totalFiles}] ${file.originalname}: ${error.message}`
          );
        }
      }

      const successCount = processedFiles.filter((f) => f.success).length;
      const totalTime = Date.now() - startTime;

      console.log(
        `\n🎉 Completado: ${successCount}/${totalFiles} archivos en ${(
          totalTime / 1000
        ).toFixed(2)}s\n`
      );
    });
  } catch (error) {
    console.error("Error al procesar archivos:", error);
    res.status(500).json({
      success: false,
      message: "Error al procesar los archivos",
      error: error.message,
    });
  }
});

// Ruta para obtener archivos procesados
app.get("/api/get-files", (req, res) => {
  res.json({
    success: true,
    files: processedFiles,
    total: processedFiles.length,
    timestamp: new Date().toISOString(),
  });
});

// Ruta para limpiar archivos procesados
app.post("/api/clear-files", (req, res) => {
  try {
    const outputDir = path.join(__dirname, "tested_Censurado");

    // Eliminar archivos físicos
    if (fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir);
      files.forEach((file) => {
        const filePath = path.join(outputDir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      });
    }

    // Limpiar lista en memoria
    processedFiles = [];

    res.json({
      success: true,
      message: "Archivos limpiados correctamente",
    });
  } catch (error) {
    console.error("Error al limpiar archivos:", error);
    res.status(500).json({
      success: false,
      message: "Error al limpiar los archivos",
      error: error.message,
    });
  }
});

// Ruta para reprocesar archivos con error
app.post("/api/retry-errors", async (req, res) => {
  try {
    const errorDir = path.join(__dirname, "temp_uploads", "errors");

    if (!fs.existsSync(errorDir)) {
      return res.json({
        success: true,
        message: "No hay archivos con error para reprocesar",
        totalFiles: 0,
      });
    }

    const errorFiles = fs
      .readdirSync(errorDir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"));

    if (errorFiles.length === 0) {
      return res.json({
        success: true,
        message: "No hay archivos con error para reprocesar",
        totalFiles: 0,
      });
    }

    const totalFiles = errorFiles.length;

    // Responder inmediatamente
    res.json({
      success: true,
      message: `Reprocesando ${totalFiles} archivos con error...`,
      totalFiles: totalFiles,
      processing: true,
      timestamp: new Date().toISOString(),
    });

    // Limpiar archivos procesados anteriormente con error
    processedFiles = processedFiles.filter((f) => f.success);

    // Procesar en segundo plano
    setImmediate(async () => {
      const startTime = Date.now();
      const outputDir = path.join(__dirname, "tested_Censurado");

      for (let i = 0; i < errorFiles.length; i++) {
        const filename = errorFiles[i];
        const errorPath = path.join(errorDir, filename);
        const startFileTime = Date.now();

        try {
          const fileBuffer = fs.readFileSync(errorPath);
          const outputPath = path.join(outputDir, filename);
          const finalFilename = await censorPdf(
            fileBuffer,
            outputPath,
            filename
          );

          const fileData = {
            id: Date.now() + Math.random() + i,
            filename: filename,
            finalFilename: finalFilename,
            size: fileBuffer.length,
            uploadDate: new Date().toISOString(),
            processingTime: Date.now() - startFileTime,
            success: true,
          };

          processedFiles.push(fileData);

          // Eliminar archivo de carpeta de errores
          fs.unlinkSync(errorPath);

          console.log(
            `✅ [${i + 1}/${totalFiles}] ${finalFilename} (${
              Date.now() - startFileTime
            }ms)`
          );
        } catch (error) {
          const fileData = {
            id: Date.now() + Math.random() + i,
            filename: filename,
            size: 0,
            uploadDate: new Date().toISOString(),
            processingTime: Date.now() - startFileTime,
            success: false,
            error: error.message,
          };

          processedFiles.push(fileData);
          console.log(
            `❌ [${i + 1}/${totalFiles}] ${filename}: ${error.message}`
          );
        }
      }

      const successCount = processedFiles.filter((f) => f.success).length;
      const totalTime = Date.now() - startTime;

      console.log(
        `\n🎉 Reprocesado: ${successCount}/${totalFiles} archivos en ${(
          totalTime / 1000
        ).toFixed(2)}s\n`
      );
    });
  } catch (error) {
    console.error("Error al reprocesar archivos:", error);
    res.status(500).json({
      success: false,
      message: "Error al reprocesar archivos",
      error: error.message,
    });
  }
});

// Ruta para descargar ZIP con los PDFs testados
app.get("/api/download-zip", (req, res) => {
  const archiver = require("archiver");
  const archive = archiver("zip", { zlib: { level: 9 } });

  res.attachment("testados.zip");
  archive.pipe(res);

  const outputDir = path.join(__dirname, "tested_Censurado");
  const files = processedFiles.filter((f) => f.success);

  files.forEach((fileData) => {
    const filePath = path.join(
      outputDir,
      fileData.finalFilename || fileData.filename
    );
    if (fs.existsSync(filePath)) {
      archive.file(filePath, {
        name: fileData.finalFilename || fileData.filename,
      });
    }
  });

  // Agregar log de errores
  const errorLog = processedFiles
    .filter((f) => !f.success)
    .map((f) => `${f.filename}: ${f.error}`)
    .join("\n");

  if (errorLog) {
    archive.append(errorLog, { name: "errores.txt" });
  }

  archive.finalize();
});

// Iniciar servidor
app.listen(PORT, HOST, () => {
  const os = require("os");
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  console.log("\n🚀 Servidor iniciado");
  console.log(`   Local:   http://localhost:${PORT}`);
  addresses.forEach((addr) => {
    console.log(`   Red:     http://${addr}:${PORT}`);
  });
  console.log("\n📁 Límite: 1000 archivos PDF");
  console.log("💾 Tamaño máximo: 50MB por archivo\n");
});
