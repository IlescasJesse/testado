/**
 * censura.ts — Censura de PDFs de contratos (sin cifrado).
 *
 * Exporta `testarPdf`, que aplica toda la censura que hacía `censorPdf` en
 * server.js EXCEPTO el bloque qpdf (cifrado, Task 5) y la escritura/renombrado
 * a disco.
 *
 * Operaciones de censura (en el mismo orden que server.js):
 *   1. detectarYTestarRFCEnImagen  — página 2 (índice 1): detecta el RFC en la
 *      imagen OCR con coordenadas TSV, dibuja recuadro negro en canvas, embebe
 *      la imagen resultante en el PDF.
 *   2. censurarFirmasLaterales     — franjas blancas de 7.5 % del ancho en ambos
 *      laterales de todas las páginas.
 *   3. detectarYCensurarFirmaUltimaPagina — cubre la firma autógrafa entre el
 *      encabezado "EL PRESTADOR DE SERVICIOS" y el nombre del empleado.
 *
 * Los datos (rfc, nombre, fecha) se obtienen reutilizando `detectarDatos` de
 * ocr.ts para no duplicar la extracción de texto.
 *
 * Dependencias nativas requeridas en el host:
 *   - poppler-utils  (pdftoppm — vía pdf-poppler)
 *   - tesseract-ocr  (idioma "spa")
 *   - canvas         (npm package — enlace nativo)
 *   - pdf-lib + @pdf-lib/fontkit
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { detectarDatos } from "./ocr.js";
import type { ResultadoOCR } from "./ocr.js";

// ── Interfaces mínimas para libs sin tipos completos ──────────────────────────
// Nota: pdf-poppler está tipado en types/pdf-poppler.d.ts — no se necesita
// PopplerOpts ni PopplerModule locales. Se importa ConvertOptions del módulo.

/** Módulo canvas */
interface CanvasImage {
  width: number;
  height: number;
}
interface CanvasRenderingContext {
  drawImage(img: CanvasImage, x: number, y: number): void;
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
}
interface CanvasEl {
  getContext(type: "2d"): CanvasRenderingContext;
  toBuffer(mime: "image/png"): Buffer;
  width: number;
  height: number;
}
interface CanvasModule {
  createCanvas(w: number, h: number): CanvasEl;
  loadImage(src: string | Buffer): Promise<CanvasImage>;
  registerFont(path: string, opts: { family: string }): void;
}


// ── Resultado de testarPdf ────────────────────────────────────────────────────

export interface ResultadoCensura {
  /** PDF censurado como Buffer. Comienza con %PDF. */
  bytes: Buffer;
  /** RFC detectado vía OCR, o null. */
  rfc: string | null;
  /** Nombre del empleado detectado vía OCR, o null. */
  nombre: string | null;
  /** Fecha del contrato detectada vía OCR, o null. */
  fecha: Date | null;
}

// ── Helpers de temporales ─────────────────────────────────────────────────────

/** Genera una ruta única en el dir temporal del SO. */
function tmpPath(prefijo: string, ext: string): string {
  return path.join(
    os.tmpdir(),
    `${prefijo}_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`,
  );
}

/** Elimina un archivo si existe; ignora errores. */
function limpiar(ruta: string | null): void {
  if (!ruta) return;
  try {
    if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
  } catch {
    // ignorar
  }
}

// ── Ruta de fuentes ───────────────────────────────────────────────────────────
// La fuente Montserrat-Regular.ttf vive en la raíz del proyecto (fonts/).
// __dirname apunta a packages/pdf-core/src/ en tiempo de ejecución (ts-node/vitest).
// Se busca con dos estrategias: relativa a __dirname y relativa al CWD.

function resolverFuenteMontserrat(): string {
  const candidatos = [
    // Cuando se ejecuta desde packages/pdf-core/src/
    path.resolve(__dirname, "../../../fonts/Montserrat-Regular.ttf"),
    // Cuando CWD es la raíz del monorepo
    path.resolve(process.cwd(), "fonts/Montserrat-Regular.ttf"),
    // Relativo a packages/pdf-core/
    path.resolve(__dirname, "../../fonts/Montserrat-Regular.ttf"),
  ];
  for (const c of candidatos) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `No se encontró Montserrat-Regular.ttf. Buscado en:\n  ${candidatos.join("\n  ")}`,
  );
}

// ── Función interna: detectar RFC en imagen y dibujar recuadro negro ──────────
// Corresponde a detectarYTestarRFCEnImagen en server.js (líneas 57-303).
// Diferencia: usa os.tmpdir() en lugar de __dirname/temp_uploads.
// Devuelve la ruta de la imagen "tested" (con el recuadro negro dibujado),
// o null si no fue posible generarla.

async function detectarRFCEnImagenConRecuadro(
  pdfBytes: Buffer,
  pageIndex: number,
): Promise<string | null> {
  const poppler = await import("pdf-poppler");
  const canvasMod = (await import("canvas")) as CanvasModule;

  const prefijo = `ocr_rfc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tempPdfPath = tmpPath("rfc_pdf", ".pdf");
  const imgPath = path.join(
    os.tmpdir(),
    `${prefijo}-${pageIndex + 1}.png`,
  );
  const tsvBasePath = path.join(os.tmpdir(), `${prefijo}_tsv`);
  const tsvPath = `${tsvBasePath}.tsv`;

  try {
    fs.writeFileSync(tempPdfPath, pdfBytes);

    const opts: import("pdf-poppler").ConvertOptions = {
      format: "png",
      out_dir: os.tmpdir(),
      out_prefix: prefijo,
      page: pageIndex + 1, // pdf-poppler espera 1-based
      scale: 2048,
    };
    await poppler.convert(tempPdfPath, opts);

    if (!fs.existsSync(imgPath)) {
      console.warn("[censura] No se generó imagen OCR para RFC");
      return null;
    }

    // Pase OCR texto plano
    const tesseract = (await import("node-tesseract-ocr")) as {
      recognize(imgPath: string, config: { lang: string; oem: number; psm: number }): Promise<string>;
    };
    const text = await tesseract.recognize(imgPath, { lang: "spa", oem: 1, psm: 3 });

    // Pase OCR TSV para coordenadas por palabra
    execSync(
      `tesseract "${imgPath}" "${tsvBasePath}" -l spa --oem 1 --psm 3 tsv`,
      { encoding: "utf8" },
    );
    const tsv = fs.readFileSync(tsvPath, "utf8");

    const cleanedOCRText = text.toUpperCase();
    const lines = tsv.split("\n");

    // Estructuras de palabras con bounding box (igual que server.js líneas 106-124)
    interface Palabra {
      text: string;
      left: number;
      top: number;
      w: number;
      h: number;
      right: number;
      bottom: number;
    }
    const words: Palabra[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      if (cols.length < 12) continue;
      const wordText = cols[11]?.trim() ?? "";
      const left = parseInt(cols[6]);
      const top = parseInt(cols[7]);
      const w = parseInt(cols[8]);
      const h = parseInt(cols[9]);
      if (!wordText || isNaN(left) || isNaN(top) || isNaN(w) || isNaN(h))
        continue;
      words.push({ text: wordText, left, top, w, h, right: left + w, bottom: top + h });
    }

    // Detectar RFC del texto completo (igual que server.js líneas 131-158)
    let rfc: string | null = null;
    const rfcCandidates: Array<{ value: string; word: Palabra }> = [];

    const rfcPatterns: RegExp[] = [
      /(?:RFC|R\.F\.C\.|N[UÚ]MERO(?:\s+DE)?\s+RFC|N[UÚ]MERO\s*:\s*RFC)\s*[:\-]?\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3})/i,
      /(?:N[UÚ]MERO\s*:\s*)([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3})/i,
      /([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3})/i,
    ];

    for (const pat of rfcPatterns) {
      const match = cleanedOCRText.match(pat);
      if (match?.[1]) {
        const candidate = match[1].replace(/[^A-Z0-9Ñ&]/g, "").toUpperCase();
        if (candidate.length === 12 || candidate.length === 13) {
          rfc = candidate;
          break;
        }
      }
    }

    const candidateRegexp = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3}$/;
    for (const word of words) {
      const cleaned = word.text.toUpperCase().replace(/[^A-Z0-9Ñ&]/g, "");
      if (candidateRegexp.test(cleaned)) {
        rfcCandidates.push({ value: cleaned, word });
      }
    }

    if (!rfc && rfcCandidates.length > 0) {
      rfc = rfcCandidates[0].value;
    }

    // Dibujar imagen con canvas (igual que server.js líneas 161-288)
    const image = await canvasMod.loadImage(imgPath);
    const canvas = canvasMod.createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);

    // Registrar fuente Montserrat para canvas (server.js línea 221-224)
    try {
      const fontPath = resolverFuenteMontserrat();
      canvasMod.registerFont(fontPath, { family: "Montserrat" });
    } catch {
      // Si no hay fuente, continuar sin ella (el recuadro negro no la necesita)
    }

    let rfcFound = false;
    let minX = Infinity,
      minY = Infinity,
      maxX = 0,
      maxY = 0;

    // Buscar RFC completo en TSV (server.js líneas 172-193)
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      if (cols.length < 12) continue;
      const rawText = cols[11]?.trim() ?? "";
      const tokenText = rawText.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const left = parseInt(cols[6]);
      const top = parseInt(cols[7]);
      const w = parseInt(cols[8]);
      const h = parseInt(cols[9]);
      if (!tokenText || isNaN(left) || isNaN(top)) continue;
      if (tokenText === rfc) {
        minX = left;
        minY = top;
        maxX = left + w;
        maxY = top + h;
        rfcFound = true;
        break;
      }
    }

    // Buscar por fragmentos si no se encontró completo (server.js líneas 196-219)
    if (!rfcFound) {
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        if (cols.length < 12) continue;
        const rawText = cols[11]?.trim() ?? "";
        const tokenText = rawText.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const left = parseInt(cols[6]);
        const top = parseInt(cols[7]);
        const w = parseInt(cols[8]);
        const h = parseInt(cols[9]);
        if (!tokenText || isNaN(left) || isNaN(top)) continue;
        if (rfc && tokenText.length >= 8 && rfc.includes(tokenText)) {
          minX = Math.min(minX, left);
          minY = Math.min(minY, top);
          maxX = Math.max(maxX, left + w);
          maxY = Math.max(maxY, top + h);
          rfcFound = true;
        }
      }
    }

    let x: number, y: number, width: number, height: number;

    if (rfcFound && minX < Infinity) {
      x = minX;
      y = minY;
      width = maxX - minX;
      height = maxY - minY;
    } else {
      // Fallback: buscar "b)" y "número" (server.js líneas 234-264)
      let fallbackY = 690;
      let fallbackX = 970;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        if (cols.length < 12) continue;
        const tokenText = cols[11]?.trim().toLowerCase() ?? "";

        if (tokenText.includes("b)")) {
          for (let j = i; j < Math.min(i + 20, lines.length); j++) {
            const cols2 = lines[j].split("\t");
            if (cols2.length < 12) continue;
            const text2 = cols2[11]?.trim().toLowerCase() ?? "";
            if (text2.includes("número") && !text2.includes("edificio")) {
              fallbackY = parseInt(cols2[7]) || fallbackY;
              fallbackX = parseInt(cols2[6]) + parseInt(cols2[8]) + 50 || fallbackX;
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

    // SIEMPRE dibujar el recuadro negro (server.js líneas 266-273)
    ctx.fillStyle = "#000000";
    ctx.fillRect(
      x,
      y,
      width + (rfcFound ? 25 : 0),
      height + (rfcFound ? 16 : 0),
    );

    if (rfc) {
      console.log(`[censura] RFC detectado y testado: ${rfc}`);
    } else {
      console.warn("[censura] No se detectó RFC (fallback), se dibujó región de prueba");
    }

    // Guardar imagen "tested" (server.js líneas 283-288)
    const testedImgPath = path.join(
      os.tmpdir(),
      `tested_${Date.now()}_${Math.random().toString(36).slice(2)}.png`,
    );
    const imgBuffer = canvas.toBuffer("image/png");
    fs.writeFileSync(testedImgPath, imgBuffer);

    return testedImgPath;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[censura] OCR RFC Error: ${msg}`);
    return null;
  } finally {
    limpiar(tempPdfPath);
    limpiar(imgPath);
    limpiar(tsvPath);
  }
}

// ── Función interna: censurar firmas/rúbricas laterales ───────────────────────
// Corresponde a censurarFirmasLaterales en server.js (líneas 464-489).
// Parámetros y offsets idénticos.

async function censurarFirmasLaterales(
  pdfDoc: import("pdf-lib").PDFDocument,
): Promise<void> {
  const { rgb } = await import("pdf-lib");
  const paginas = pdfDoc.getPages();
  for (const pagina of paginas) {
    const { width, height } = pagina.getSize();
    // Ancho de la franja lateral: ~7.5 % del ancho de página
    const lateralW = width * 0.075;

    pagina.drawRectangle({
      x: 0,
      y: 0,
      width: lateralW,
      height,
      color: rgb(1, 1, 1),
    });
    pagina.drawRectangle({
      x: width - lateralW,
      y: 0,
      width: lateralW,
      height,
      color: rgb(1, 1, 1),
    });
  }
}

// ── Función interna: fallback firma última página ─────────────────────────────
// Corresponde a aplicarFallbackFirmaUltimaPagina en server.js (líneas 686-697).

async function aplicarFallbackFirmaUltimaPagina(
  pagina: import("pdf-lib").PDFPage,
  pdfW: number,
  pdfH: number,
): Promise<void> {
  const { rgb } = await import("pdf-lib");
  const x = pdfW * 0.15;
  const y = pdfH * 0.46;
  const w = pdfW * 0.75;
  const h = pdfH * 0.1;
  pagina.drawRectangle({ x, y, width: w, height: h, color: rgb(0, 0, 0) });
}

// ── Función interna: censurar firma autógrafa en última página ────────────────
// Corresponde a detectarYCensurarFirmaUltimaPagina en server.js (líneas 491-682).
// Parámetros, offsets y lógica de bounding box idénticos.

async function detectarYCensurarFirmaUltimaPagina(
  pdfBytes: Buffer,
  pdfDoc: import("pdf-lib").PDFDocument,
): Promise<void> {
  const { rgb } = await import("pdf-lib");
  const poppler = await import("pdf-poppler");
  const canvasMod = (await import("canvas")) as CanvasModule;

  const paginas = pdfDoc.getPages();
  const ultimoIdx = paginas.length - 1;
  const ultimaPagina = paginas[ultimoIdx];
  const { width: pdfW, height: pdfH } = ultimaPagina.getSize();

  const prefijo = `ocr_firma_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tempPdfPath = tmpPath("firma_pdf", ".pdf");
  const imgPath = path.join(os.tmpdir(), `${prefijo}-${ultimoIdx + 1}.png`);
  const tsvBasePath = path.join(os.tmpdir(), `${prefijo}_tsv`);
  const tsvPath = `${tsvBasePath}.tsv`;

  try {
    fs.writeFileSync(tempPdfPath, pdfBytes);

    const opts: import("pdf-poppler").ConvertOptions = {
      format: "png",
      out_dir: os.tmpdir(),
      out_prefix: prefijo,
      page: ultimoIdx + 1,
      scale: 2048,
    };
    await poppler.convert(tempPdfPath, opts);

    if (!fs.existsSync(imgPath)) {
      console.warn("[censura] No se generó imagen para última página, usando fallback firma");
      await aplicarFallbackFirmaUltimaPagina(ultimaPagina, pdfW, pdfH);
      return;
    }

    execSync(
      `tesseract "${imgPath}" "${tsvBasePath}" -l spa --oem 1 --psm 3 tsv`,
      { encoding: "utf8" },
    );
    const tsv = fs.readFileSync(tsvPath, "utf8");

    const imgObj = await canvasMod.loadImage(imgPath);
    const imgW = imgObj.width;
    const imgH = imgObj.height;

    // Factores de conversión píxeles → puntos PDF
    const scX = pdfW / imgW;
    const scY = pdfH / imgH;

    const lines = tsv.split("\n");

    // Buscar "PRESTADOR" como ancla (server.js líneas 554-588)
    const PHRASE_TOKENS = new Set(["EL", "PRESTADOR", "DE", "SERVICIOS", "SERVICIO"]);
    let anchorImgY: number | null = null;
    let anchorImgX: number | null = null;
    let anchorImgH = 40;
    let anchorImgW = 400;
    let phraseMinX = Infinity;
    let phraseMaxX = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      if (cols.length < 12) continue;
      const text = cols[11]?.trim().toUpperCase() ?? "";
      const left = parseInt(cols[6]);
      const top = parseInt(cols[7]);
      const w = parseInt(cols[8]);
      const h = parseInt(cols[9]);

      const enMitadDerecha = !isNaN(left) && left > imgW * 0.1;
      const enMitadSuperior = !isNaN(top) && top < imgH * 0.7;

      if (
        (text.includes("PRESTADOR") || text.includes("SERVICIOS")) &&
        enMitadDerecha &&
        enMitadSuperior
      ) {
        anchorImgY = top;
        anchorImgX = left;
        if (!isNaN(h)) anchorImgH = h;
        if (!isNaN(w)) anchorImgW = w;
        break;
      }
    }

    // Expandir al ancho real de toda la frase (server.js líneas 591-614)
    if (anchorImgY !== null) {
      const lineThresh = anchorImgH * 1.5;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        if (cols.length < 12) continue;
        const text =
          (cols[11]?.trim().toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ]/g, "")) ?? "";
        const left = parseInt(cols[6]);
        const top = parseInt(cols[7]);
        const w = parseInt(cols[8]);
        if (isNaN(left) || isNaN(top) || isNaN(w)) continue;
        if (Math.abs(top - anchorImgY) > lineThresh) continue;
        if (PHRASE_TOKENS.has(text)) {
          phraseMinX = Math.min(phraseMinX, left);
          phraseMaxX = Math.max(phraseMaxX, left + w);
        }
      }
      if (phraseMaxX > phraseMinX) {
        anchorImgX = phraseMinX;
        anchorImgW = phraseMaxX - phraseMinX;
      }
    }

    if (anchorImgY !== null && anchorImgX !== null) {
      const anchorBottom = anchorImgY + anchorImgH;

      // Buscar nombre del empleado (server.js líneas 630-645)
      let nameImgYTop = anchorBottom + 220;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        if (cols.length < 12) continue;
        const rowTop = parseInt(cols[7]);
        const rowText = cols[11]?.trim() ?? "";
        if (
          !isNaN(rowTop) &&
          rowTop > anchorBottom + 20 &&
          rowTop < anchorBottom + 500 &&
          rowText.length > 2
        ) {
          nameImgYTop = rowTop;
          break;
        }
      }

      // Rectángulo que cubre SOLO la firma (server.js líneas 648-667)
      const sigImgY = anchorBottom + 5;
      const sigImgH = Math.max(20, nameImgYTop - 5 - sigImgY);
      const sigImgX = Math.max(0, anchorImgX - 5);
      const sigImgW = anchorImgW + 10;

      const pdfBloqueX = sigImgX * scX;
      const pdfBloqueY = pdfH - (sigImgY + sigImgH) * scY;
      const pdfBloqueW = sigImgW * scX;
      const pdfBloqueH = sigImgH * scY;

      ultimaPagina.drawRectangle({
        x: Math.max(0, pdfBloqueX),
        y: Math.max(0, pdfBloqueY),
        width: Math.min(pdfW - pdfBloqueX, pdfBloqueW),
        height: Math.max(0, pdfBloqueH),
        color: rgb(0, 0, 0),
      });
    } else {
      console.warn("[censura] No se encontró 'PRESTADOR' en última página, usando fallback");
      await aplicarFallbackFirmaUltimaPagina(ultimaPagina, pdfW, pdfH);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[censura] OCR Firma última página: ${msg}`);
    await aplicarFallbackFirmaUltimaPagina(ultimaPagina, pdfW, pdfH);
  } finally {
    limpiar(tempPdfPath);
    limpiar(imgPath);
    limpiar(tsvPath);
  }
}

// ── Función principal exportada ───────────────────────────────────────────────

/**
 * Censura un PDF de contrato sin cifrar.
 *
 * Aplica (en orden):
 *   1. Detección del RFC en imagen OCR de la página 2 con dibujo del recuadro negro.
 *   2. Franjas blancas laterales (~7.5 % del ancho) en TODAS las páginas.
 *   3. Censura de la firma autógrafa en la última página (ancla "PRESTADOR DE SERVICIOS").
 *
 * NO cifra el PDF (eso es Task 5).
 * NO escribe archivos a disco ni renombra (eso lo hace la capa API).
 *
 * @param input - Buffer con el contenido del PDF original.
 * @returns Objeto con el PDF censurado como Buffer y los datos OCR extraídos.
 */
export async function testarPdf(
  input: Buffer,
): Promise<{ bytes: Buffer; rfc: string | null; nombre: string | null; fecha: Date | null }> {
  const { PDFDocument } = await import("pdf-lib");
  const fontkitMod = await import("@pdf-lib/fontkit");
  // En CJS compilado, import() devuelve el namespace; el objeto real está en .default
  const fontkitInst = (fontkitMod as { default?: unknown }).default ?? fontkitMod;

  const pdfDoc = await PDFDocument.load(input);
  const paginas = pdfDoc.getPages();

  // Cargar fuente Montserrat (server.js líneas 896-900)
  pdfDoc.registerFontkit(fontkitInst as Parameters<typeof pdfDoc.registerFontkit>[0]);
  const fontPath = resolverFuenteMontserrat();
  const montserratBytes = fs.readFileSync(fontPath);
  await pdfDoc.embedFont(montserratBytes);

  // 1. Detectar RFC en imagen de página 2 y dibujar recuadro negro (server.js líneas 902-923)
  if (paginas.length >= 2) {
    const testedImgPath = await detectarRFCEnImagenConRecuadro(input, 1);

    if (testedImgPath && fs.existsSync(testedImgPath)) {
      try {
        const pagina2 = paginas[1];
        const { width, height } = pagina2.getSize();

        const imgBuffer = fs.readFileSync(testedImgPath);
        const pngImage = await pdfDoc.embedPng(imgBuffer);

        pagina2.drawImage(pngImage, {
          x: 0,
          y: 0,
          width,
          height,
          opacity: 1.0,
        });
      } finally {
        limpiar(testedImgPath);
      }
    }
  }

  // 2. Censurar firmas/rúbricas laterales en todas las páginas (server.js línea 944)
  await censurarFirmasLaterales(pdfDoc);

  // 3. Censurar firma autógrafa en la última página (server.js línea 947)
  await detectarYCensurarFirmaUltimaPagina(input, pdfDoc);

  // Guardar PDF censurado en memoria
  const pdfBytes = await pdfDoc.save();
  const bytes = Buffer.from(pdfBytes);

  // Obtener datos (RFC, nombre, fecha) reutilizando detectarDatos de ocr.ts.
  // El RFC y nombre del prestador están en la página 2 del contrato (índice 1),
  // que es también la página donde se detecta el RFC para dibujar el recuadro.
  // Se intenta primero en la página 2; si no se detecta RFC, se intenta en la 1.
  let datosOCR: ResultadoOCR = { rfc: null, nombre: null, fecha: null };
  try {
    datosOCR = await detectarDatos(input, { pageIndex: 1 });
    // Fallback a página 1 si no se detectó RFC en página 2
    if (!datosOCR.rfc && paginas.length >= 1) {
      const datosPag1 = await detectarDatos(input, { pageIndex: 0 });
      if (datosPag1.rfc) {
        datosOCR = datosPag1;
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[censura] No se pudieron obtener datos OCR adicionales: ${msg}`);
  }

  return {
    bytes,
    rfc: datosOCR.rfc,
    nombre: datosOCR.nombre,
    fecha: datosOCR.fecha,
  };
}
