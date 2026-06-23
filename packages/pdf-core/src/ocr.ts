/**
 * ocr.ts — Extracción de datos (RFC, nombre, fecha) de un PDF mediante OCR.
 *
 * Dependencias nativas requeridas en el host:
 *   - poppler-utils  (pdftoppm/pdfinfo — vía pdf-poppler)
 *   - tesseract-ocr  (idioma "spa" instalado)
 *
 * Heurísticas de extracción
 * ─────────────────────────
 * RFC
 *   1. Busca etiquetas contextuales ("RFC", "R.F.C.", "NÚMERO DE RFC", etc.)
 *      seguidas del patrón RFC en el texto completo en mayúsculas.
 *   2. Si falla, busca el patrón RFC crudo en el texto completo.
 *   3. Si falla, extrae candidatos token a token del TSV de posiciones y toma
 *      el primero que cumpla longitud 12 ó 13.
 *   Patrón RFC: /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3}$/ (12–13 caracteres).
 *
 * Nombre del empleado
 *   Busca la línea que sigue a los tokens "NOMBRE", "NOMBRE COMPLETO",
 *   "C.", "C.C." o "EL PRESTADOR" en el texto completo (normalizado a
 *   mayúsculas, sin acentos). Si encuentra una línea no vacía de ≥ 5 caracteres
 *   que solo contiene letras, espacios e indicadores de grado (ú, ó, á, etc.),
 *   la devuelve como nombre. Devuelve null si no se detecta con suficiente
 *   confianza.
 *
 * Fecha del contrato
 *   1. Busca patrones ISO (AAAA-MM-DD) y formatos largos en español
 *      ("15 de enero de 2025", "15/01/2025", "15-01-2025").
 *   2. Acepta meses en español (enero … diciembre) con variantes OCR comunes
 *      (ene, feb, mar, abr, may, jun, jul, ago, sep/set, oct, nov, dic).
 *   3. Solo considera fechas con año entre 2000 y 2099.
 *   Devuelve el primer match como objeto Date o null.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";

// ── Interfaces mínimas para libs sin tipos completos ──────────────────────────

/** Configuración que acepta node-tesseract-ocr */
interface TesseractConfig {
  lang: string;
  oem: number;
  psm: number;
}

/** Módulo node-tesseract-ocr */
interface TesseractModule {
  recognize(imgPath: string, config: TesseractConfig): Promise<string>;
}

/** Opciones que acepta pdf-poppler para conversión */
interface PopplerOpts {
  format: string;
  out_dir: string;
  out_prefix: string;
  page: number;
  scale: number;
}

/** Módulo pdf-poppler */
interface PopplerModule {
  convert(pdfPath: string, opts: PopplerOpts): Promise<void>;
}

// ── Parámetros opcionales de detectarDatos ────────────────────────────────────

export interface OpcionesOCR {
  /** Resolución de render en escala poppler (default 2048, igual que server.js). */
  scale?: number;
  /** Índice 0-based de la página a analizar (default 0 = primera página). */
  pageIndex?: number;
}

// ── Resultado ─────────────────────────────────────────────────────────────────

export interface ResultadoOCR {
  rfc: string | null;
  nombre: string | null;
  fecha: Date | null;
}

// ── Helpers internos ──────────────────────────────────────────────────────────

/** Mapa de nombres de mes en español (y abreviaturas OCR) → número de mes (1-based). */
const MESES: Readonly<Record<string, number>> = {
  enero: 1, ene: 1,
  febrero: 2, feb: 2,
  marzo: 3, mar: 3,
  abril: 4, abr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6,
  julio: 7, jul: 7,
  agosto: 8, ago: 8,
  septiembre: 9, sep: 9, set: 9,
  octubre: 10, oct: 10,
  noviembre: 11, nov: 11,
  diciembre: 12, dic: 12,
};

/** Elimina acentos/diacríticos de una cadena. */
function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Extrae el RFC del texto completo OCR (ya en mayúsculas).
 * Prioridad: etiqueta contextual > patrón crudo > tokens TSV.
 */
function extraerRFC(textoUpper: string, tokensTSV: string[]): string | null {
  const rfcPatterns: RegExp[] = [
    // Etiqueta RFC explícita con o sin separador
    /(?:RFC|R\.F\.C\.|N[UÚ]MERO(?:\s+DE)?\s+RFC|N[UÚ]MERO\s*:\s*RFC)\s*[:\-]?\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3})/i,
    // "NÚMERO: RFCVALUE" (con dos puntos)
    /(?:N[UÚ]MERO\s*:\s*)([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3})/i,
    // "número RFCVALUE" (sólo espacio — formato típico en contratos de Oaxaca)
    /(?:N[UÚ]MERO\s+)([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3})/i,
    // RFC crudo sin contexto (fallback)
    /([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3})/i,
  ];

  for (const pat of rfcPatterns) {
    const m = textoUpper.match(pat);
    if (m?.[1]) {
      const candidate = m[1].replace(/[^A-Z0-9Ñ&]/g, "").toUpperCase();
      if (candidate.length === 12 || candidate.length === 13) return candidate;
    }
  }

  // Fallback: escanear tokens individuales del TSV
  const candidateRe = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3}$/;
  for (const tok of tokensTSV) {
    const cleaned = tok.toUpperCase().replace(/[^A-Z0-9Ñ&]/g, "");
    if (candidateRe.test(cleaned)) return cleaned;
  }

  return null;
}

/**
 * Intenta extraer el nombre del empleado del texto OCR.
 *
 * Estrategia:
 *   - Parte el texto en líneas.
 *   - Busca una línea ancla que contenga alguno de los marcadores de nombre
 *     (NOMBRE, C., EL PRESTADOR, etc.).
 *   - Toma la línea siguiente no vacía; si parece un nombre (solo letras,
 *     espacios, puntos y longitud ≥ 5) la devuelve capitalizada.
 */
function extraerNombre(texto: string): string | null {
  const lineas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const marcadores = [
    /\bNOMBRE\s+COMPLETO\b/i,
    /\bNOMBRE\s+DEL\s+(?:EMPLEADO|TRABAJADOR|PRESTADOR)\b/i,
    /\bNOMBRE\b/i,
    /\bC\.\s*C\.\b/,
    /\bEL\s+PRESTADOR\b/i,
    /\bSUBSCRIBIENTE\b/i,
    /\bSUSCRIBIENTE\b/i,
  ];

  for (let i = 0; i < lineas.length - 1; i++) {
    const lineaNorm = sinAcentos(lineas[i]).toUpperCase();
    const esMarcador = marcadores.some((re) => re.test(lineaNorm));
    if (!esMarcador) continue;

    // Buscar la próxima línea que parezca un nombre (no vacía, ≥ 5 chars,
    // mayormente letras). Se permite hasta 3 líneas adelante.
    for (let j = i + 1; j <= Math.min(i + 3, lineas.length - 1); j++) {
      const candidato = lineas[j].trim();
      // Un nombre válido: ≥ 5 chars, solo letras (con diacríticos), espacios y puntos
      if (
        candidato.length >= 5 &&
        /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ\s.]+$/.test(candidato)
      ) {
        // Capitalizar: cada palabra con primera letra mayúscula
        return candidato
          .split(/\s+/)
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
          .join(" ");
      }
    }
  }

  return null;
}

/**
 * Intenta extraer la fecha del contrato del texto OCR.
 *
 * Patrones soportados (en orden de especificidad):
 *   1. "15 de enero de 2025"  (formato largo español)
 *   2. "15/01/2025" o "15-01-2025"  (numérico separado)
 *   3. "2025-01-15"  (ISO)
 */
function extraerFecha(texto: string): Date | null {
  // Patrón 1: formato largo español
  const reEspanol =
    /\b(\d{1,2})\s+de\s+([a-záéíóúüñ]+)\s+de\s+(20\d{2})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = reEspanol.exec(texto)) !== null) {
    const dia = parseInt(m[1], 10);
    const mesNombre = sinAcentos(m[2].toLowerCase());
    const anio = parseInt(m[3], 10);
    const mes = MESES[mesNombre];
    if (mes !== undefined && dia >= 1 && dia <= 31) {
      const d = new Date(anio, mes - 1, dia);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Patrón 2: numérico DD/MM/AAAA o DD-MM-AAAA
  const reNumerico = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/g;
  while ((m = reNumerico.exec(texto)) !== null) {
    const dia = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10);
    const anio = parseInt(m[3], 10);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      const d = new Date(anio, mes - 1, dia);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Patrón 3: ISO AAAA-MM-DD
  const reISO = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
  while ((m = reISO.exec(texto)) !== null) {
    const anio = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10);
    const dia = parseInt(m[3], 10);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      const d = new Date(anio, mes - 1, dia);
      if (!isNaN(d.getTime())) return d;
    }
  }

  return null;
}

// ── Función principal ─────────────────────────────────────────────────────────

/**
 * Detecta RFC, nombre del empleado y fecha del contrato en un PDF mediante OCR.
 *
 * Renderiza la página indicada (pageIndex, 0-based) a PNG con pdf-poppler a la
 * resolución `scale` (default 2048), luego extrae texto con tesseract (lang="spa",
 * oem=1, psm=3).  Los archivos temporales se eliminan en el bloque finally.
 *
 * @param pdfBytes  - Contenido del PDF como Buffer.
 * @param opts      - Opciones opcionales (scale, pageIndex).
 * @returns         Objeto con rfc, nombre y fecha (null si no se detectan).
 */
export async function detectarDatos(
  pdfBytes: Buffer,
  opts: OpcionesOCR = {},
): Promise<ResultadoOCR> {
  const escala = opts.scale ?? 2048;
  const paginaIdx = opts.pageIndex ?? 0; // 0-based externamente

  // Importaciones dinámicas para que el módulo no explote si las libs no están
  // instaladas — los tests de contrato pueden hacer import estático con vitest.
  const tesseract = (await import("node-tesseract-ocr")) as TesseractModule;
  const poppler = (await import("pdf-poppler")) as PopplerModule;

  const tmpDir = os.tmpdir();
  const prefijo = `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tempPdfPath = path.join(tmpDir, `${prefijo}.pdf`);
  const popplerOpts: PopplerOpts = {
    format: "png",
    out_dir: tmpDir,
    out_prefix: prefijo,
    page: paginaIdx + 1, // pdf-poppler espera 1-based
    scale: escala,
  };
  // Paths derivados de las convenciones de pdf-poppler
  const imgPath = path.join(tmpDir, `${prefijo}-${paginaIdx + 1}.png`);
  const tsvBasePath = path.join(tmpDir, `${prefijo}_tsv`);
  const tsvPath = `${tsvBasePath}.tsv`;

  try {
    // 1. Escribir PDF temporal
    fs.writeFileSync(tempPdfPath, pdfBytes);

    // 2. Convertir página a PNG
    await poppler.convert(tempPdfPath, popplerOpts);

    if (!fs.existsSync(imgPath)) {
      console.warn(`[ocr] No se generó imagen en ${imgPath}`);
      return { rfc: null, nombre: null, fecha: null };
    }

    // 3. OCR en texto plano
    const tesseractConfig: TesseractConfig = { lang: "spa", oem: 1, psm: 3 };
    const textoPlano = await tesseract.recognize(imgPath, tesseractConfig);
    const textoUpper = textoPlano.toUpperCase();

    // 4-5. Segundo pase OCR → TSV (posiciones por palabra). Es SOLO un fallback
    //      para extraer candidatos RFC token a token. Se aísla en su propio
    //      try/catch para que un fallo aquí (p. ej. tesseract CLI no disponible
    //      o error de I/O) NO descarte el RFC/nombre/fecha ya obtenidos del
    //      primer pase de texto plano.
    const tokensTSV: string[] = [];
    try {
      execSync(
        `tesseract "${imgPath}" "${tsvBasePath}" -l spa --oem 1 --psm 3 tsv`,
        { encoding: "utf8" },
      );

      if (fs.existsSync(tsvPath)) {
        const tsv = fs.readFileSync(tsvPath, "utf8");
        for (const linea of tsv.split("\n").slice(1)) {
          const cols = linea.split("\t");
          if (cols.length < 12) continue;
          const tok = cols[11]?.trim();
          if (tok) tokensTSV.push(tok);
        }
      }
    } catch (errTSV) {
      const msg = errTSV instanceof Error ? errTSV.message : String(errTSV);
      console.warn(
        `[ocr] Pase TSV falló (se continúa con el texto plano): ${msg}`,
      );
    }

    // 6. Extraer campos
    const rfc = extraerRFC(textoUpper, tokensTSV);
    const nombre = extraerNombre(textoPlano);
    const fecha = extraerFecha(textoPlano);

    if (rfc) console.log(`[ocr] RFC detectado: ${rfc}`);
    else console.warn("[ocr] No se detectó RFC");

    return { rfc, nombre, fecha };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[ocr] Error durante OCR: ${msg}`);
    return { rfc: null, nombre: null, fecha: null };
  } finally {
    // Limpiar temporales (errores de unlink no deben propagar)
    for (const p of [tempPdfPath, imgPath, tsvPath]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // ignorar
      }
    }
  }
}
