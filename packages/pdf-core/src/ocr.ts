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
 *   Extrae la PRIMERA LÍNEA no vacía del texto OCR de la página indicada
 *   (default pág 1, índice 0). En estos contratos el nombre del prestador
 *   aparece en el encabezado superior izquierdo como primer elemento de texto.
 *   Si la primera línea parece un nombre válido (≥ 5 chars, mayormente letras
 *   y espacios) se devuelve normalizado a mayúsculas. Si no, se intenta la
 *   estrategia legacy de buscar marcadores (NOMBRE, EL PRESTADOR, etc.).
 *   Devuelve null si no se detecta con suficiente confianza.
 *
 * Fecha del contrato
 *   Busca un RANGO de fechas en español de la forma:
 *     "DEL <dd> DE <MES> [DE <yyyy>] AL <dd> DE <MES> DE <yyyy>"
 *   Devuelve la fecha de INICIO del rango. El año final del rango se aplica a
 *   ambos extremos cuando solo aparece al final. Esta heurística se aplica
 *   preferentemente al texto de la página 4 (índice 3), donde aparece la
 *   cláusula QUINTA de vigencia en los contratos de la Secretaría de Finanzas
 *   de Oaxaca. Como fallback se usan los patrones de fecha puntual (español,
 *   numérico, ISO).
 *
 * Costo OCR página 4
 *   detectarDatos OCRea por defecto la página del RFC (pageIndex, default 0/1
 *   según quien llame) MÁS la página 4 (índice 3) para detectar la fecha de
 *   vigencia. Si el llamador ya sabe el trimestre puede ahorrar el segundo OCR
 *   pasando opts.omitirOCRFecha = true. Esta decisión prioriza exactitud sobre
 *   costo; el doble OCR ya existía para RFC + nombre en la misma página.
 *
 * Utilidad pública auxiliar
 *   nombreDesdeArchivo(nombreArchivo): quita extensión, normaliza espacios,
 *   devuelve en MAYÚSCULAS. Útil para cross-check con nombre OCR.
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

// Nota: pdf-poppler está tipado en types/pdf-poppler.d.ts (ConvertOptions).

// ── Resolución robusta del PNG generado por poppler ───────────────────────────
/**
 * Resuelve la ruta REAL del PNG que produjo pdf-poppler/pdftocairo.
 *
 * pdftocairo rellena con ceros el número de página al ancho del total de
 * páginas del documento: un PDF de ≥10 páginas genera `prefijo-04.png` (no
 * `prefijo-4.png`) y uno de ≥100 páginas `prefijo-004.png`. Asumir el nombre
 * sin relleno hace fallar `fs.existsSync` y dispara "No se generó imagen" en
 * contratos largos, aunque la conversión sí ocurrió.
 *
 * Estrategia: probar el nombre exacto (sin relleno); si no existe, escanear el
 * directorio en busca de `prefijo-<ceros><pagina>.png`. El prefijo es único por
 * llamada (Date.now()+random) y solo se convierte una página, así que habrá a
 * lo sumo una coincidencia.
 *
 * @returns ruta absoluta del PNG, o null si no se encontró.
 */
export function resolverPngGenerado(
  dir: string,
  prefijo: string,
  pagina1Based: number,
): string | null {
  const exacto = path.join(dir, `${prefijo}-${pagina1Based}.png`);
  if (fs.existsSync(exacto)) return exacto;

  let entradas: string[];
  try {
    entradas = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const prefijoEsc = prefijo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${prefijoEsc}-0*${pagina1Based}\\.png$`);
  for (const entrada of entradas) {
    if (re.test(entrada)) return path.join(dir, entrada);
  }
  return null;
}

// ── Parámetros opcionales de detectarDatos ────────────────────────────────────

export interface OpcionesOCR {
  /** Resolución de render en escala poppler (default 2048, igual que server.js). */
  scale?: number;
  /** Índice 0-based de la página a analizar para RFC/nombre (default 0 = primera página). */
  pageIndex?: number;
  /**
   * Si true, omite el OCR adicional de la página 4 para detectar la fecha de
   * vigencia (útil cuando el llamador ya conoce el trimestre y quiere ahorrar
   * el segundo OCR). Default false.
   */
  omitirOCRFecha?: boolean;
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
 * Estrategia principal (calibrada con contratos reales):
 *   El nombre aparece como la PRIMERA LÍNEA del texto OCR en estos contratos
 *   (encabezado superior de la página). Se valida que sea un nombre plausible:
 *   ≥ 5 chars, mayormente letras y espacios, sin números.
 *
 * Estrategia de respaldo:
 *   Si la primera línea no parece un nombre, busca marcadores contextuales
 *   (NOMBRE, C., EL PRESTADOR, SUSCRIBIENTE, etc.) y toma la línea siguiente.
 *
 * @param texto - Texto OCR (se normaliza internamente).
 * @returns Nombre en MAYÚSCULAS normalizado, o null.
 */
export function extraerNombre(texto: string): string | null {
  const lineas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lineas.length === 0) return null;

  // Regex de nombre válido: ≥ 5 chars, solo letras (con diacríticos), espacios; sin dígitos
  const esNombreValido = (s: string): boolean =>
    s.length >= 5 &&
    /^[A-ZÁÉÍÓÚÜÑA-Za-záéíóúüñ][A-ZÁÉÍÓÚÜÑa-záéíóúüñ\s]+$/.test(s) &&
    !/\d/.test(s);

  // Estrategia 1: primera línea como encabezado
  const primeraLinea = lineas[0] ?? "";
  if (esNombreValido(primeraLinea)) {
    return primeraLinea.toUpperCase().replace(/\s+/g, " ").trim();
  }

  // Estrategia 2: búsqueda por marcadores contextuales
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
    const lineaNorm = sinAcentos(lineas[i] ?? "").toUpperCase();
    const esMarcador = marcadores.some((re) => re.test(lineaNorm));
    if (!esMarcador) continue;

    for (let j = i + 1; j <= Math.min(i + 3, lineas.length - 1); j++) {
      const candidato = (lineas[j] ?? "").trim();
      if (esNombreValido(candidato)) {
        return candidato.toUpperCase().replace(/\s+/g, " ").trim();
      }
    }
  }

  return null;
}

/**
 * Intenta extraer la fecha de inicio de un rango de vigencia en español.
 *
 * Patrón primario (cláusula QUINTA de estos contratos):
 *   "DEL <dd> DE <MES> [DE <yyyy>] AL <dd> DE <MES> DE <yyyy>"
 *   Ejemplo real: "DEL 01 DE ABRIL AL 30 DE JUNIO DE 2026"
 *   El año al final del rango se aplica a ambos extremos (año compartido).
 *
 * Patrones de respaldo (fecha puntual):
 *   1. "15 de enero de 2025"  (formato largo español)
 *   2. "15/01/2025" o "15-01-2025"  (numérico separado)
 *   3. "2025-01-15"  (ISO)
 *
 * La función es pura (no hace OCR) y está exportada para facilitar tests unitarios.
 *
 * @param texto - Texto OCR o cualquier cadena con fechas en español.
 * @returns Fecha de inicio del rango/contrato, o null si no se detecta.
 */
export function extraerFecha(texto: string): Date | null {
  // ── Patrón 0: rango de vigencia "DEL dd DE MES [DE yyyy] AL dd DE MES DE yyyy" ──
  // Tolera espacios y saltos de línea OCR entre tokens ([\s\n]+).
  // El año puede aparecer solo al final (año compartido) o en ambos extremos.
  const reLista = sinAcentos(texto.toLowerCase())
    // Normalizar saltos de línea múltiples a espacio
    .replace(/[\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ");

  // Regex para rango completo: DEL d DE mes [DE yyyy] AL d DE mes DE yyyy
  const reRangoVigor =
    /\bdel?\s+(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(20\d{2}))?\s+al?\s+\d{1,2}\s+de\s+[a-z]+\s+de\s+(20\d{2})\b/i;

  const mRango = reRangoVigor.exec(reLista);
  if (mRango) {
    const diaInicio = parseInt(mRango[1] ?? "0", 10);
    const mesNombreInicio = mRango[2] ?? "";
    // Año inicio: si aparece explícito úsalo; si no, toma el año del extremo final
    const anioInicio = parseInt(mRango[3] ?? mRango[4] ?? "0", 10);
    const mesInicio = MESES[mesNombreInicio];

    if (
      mesInicio !== undefined &&
      anioInicio >= 2000 &&
      anioInicio <= 2099 &&
      diaInicio >= 1 &&
      diaInicio <= 31
    ) {
      const d = new Date(anioInicio, mesInicio - 1, diaInicio);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // ── Patrón 1: formato largo español "15 de enero de 2025" ────────────────────
  const textoNorm = sinAcentos(texto.toLowerCase()).replace(/[\r\n]+/g, " ");
  const reEspanol = /\b(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(20\d{2})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = reEspanol.exec(textoNorm)) !== null) {
    const dia = parseInt(m[1] ?? "0", 10);
    const mesNombre = m[2] ?? "";
    const anio = parseInt(m[3] ?? "0", 10);
    const mes = MESES[mesNombre];
    if (mes !== undefined && dia >= 1 && dia <= 31) {
      const d = new Date(anio, mes - 1, dia);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // ── Patrón 2: numérico DD/MM/AAAA o DD-MM-AAAA ───────────────────────────────
  const reNumerico = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/g;
  while ((m = reNumerico.exec(texto)) !== null) {
    const dia = parseInt(m[1] ?? "0", 10);
    const mes = parseInt(m[2] ?? "0", 10);
    const anio = parseInt(m[3] ?? "0", 10);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      const d = new Date(anio, mes - 1, dia);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // ── Patrón 3: ISO AAAA-MM-DD ─────────────────────────────────────────────────
  const reISO = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
  while ((m = reISO.exec(texto)) !== null) {
    const anio = parseInt(m[1] ?? "0", 10);
    const mes = parseInt(m[2] ?? "0", 10);
    const dia = parseInt(m[3] ?? "0", 10);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      const d = new Date(anio, mes - 1, dia);
      if (!isNaN(d.getTime())) return d;
    }
  }

  return null;
}

// ── Utilidad pública ──────────────────────────────────────────────────────────

/**
 * Deriva el nombre del empleado desde el nombre de archivo.
 * Quita la extensión, normaliza espacios y devuelve en MAYÚSCULAS.
 *
 * Ejemplo: "ACEVEDO MESINAS JOSIMAR.pdf" → "ACEVEDO MESINAS JOSIMAR"
 */
export function nombreDesdeArchivo(nombreArchivo: string): string {
  const sinExt = path.basename(nombreArchivo, path.extname(nombreArchivo));
  return sinExt.replace(/\s+/g, " ").trim().toUpperCase();
}

// ── Helpers de OCR interno ────────────────────────────────────────────────────

/** Tipo mínimo del módulo pdf-poppler que necesitamos en ocrarPagina. */
type PopplerModule = typeof import("pdf-poppler");

/**
 * Renderiza una página del PDF y devuelve el texto OCR plano.
 * Limpia los temporales en finally. Lanza si falla (el llamador maneja).
 */
async function ocrarPagina(
  tesseract: TesseractModule,
  poppler: PopplerModule,
  tempPdfPath: string,
  pageIndex: number,
  escala: number,
  tmpDir: string,
): Promise<string> {
  const prefijo = `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}_p${pageIndex}`;

  const popplerOpts: import("pdf-poppler").ConvertOptions = {
    format: "png",
    out_dir: tmpDir,
    out_prefix: prefijo,
    page: pageIndex + 1,
    scale: escala,
  };

  let imgPath: string | null = null;
  try {
    await poppler.convert(tempPdfPath, popplerOpts);

    imgPath = resolverPngGenerado(tmpDir, prefijo, pageIndex + 1);
    if (imgPath === null) {
      console.warn(`[ocr] No se generó imagen (prefijo ${prefijo}) para página ${pageIndex + 1}`);
      return "";
    }

    const tesseractConfig: TesseractConfig = { lang: "spa", oem: 1, psm: 3 };
    return await tesseract.recognize(imgPath, tesseractConfig);
  } finally {
    try {
      if (imgPath !== null && fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    } catch {
      // ignorar error de limpieza
    }
  }
}

// ── Función principal ─────────────────────────────────────────────────────────

/**
 * Detecta RFC, nombre del empleado y fecha del contrato en un PDF mediante OCR.
 *
 * Páginas que OCRea:
 *   - pageIndex (default 0): para RFC y nombre del empleado (encabezado).
 *   - Página 4 (índice 3): para la fecha de vigencia (cláusula QUINTA).
 *     Se omite si opts.omitirOCRFecha = true o si pageIndex === 3.
 *
 * @param pdfBytes  - Contenido del PDF como Buffer.
 * @param opts      - Opciones opcionales (scale, pageIndex, omitirOCRFecha).
 * @returns         Objeto con rfc, nombre y fecha (null si no se detectan).
 */
export async function detectarDatos(
  pdfBytes: Buffer,
  opts: OpcionesOCR = {},
): Promise<ResultadoOCR> {
  const escala = opts.scale ?? 2048;
  const paginaIdx = opts.pageIndex ?? 0; // 0-based externamente
  const omitirFecha = opts.omitirOCRFecha ?? false;

  // Importaciones dinámicas para que el módulo no explote si las libs no están
  // instaladas — los tests de contrato pueden hacer import estático con vitest.
  const tesseract = (await import("node-tesseract-ocr")) as TesseractModule;
  const poppler = await import("pdf-poppler");

  const tmpDir = os.tmpdir();
  const prefijoPdf = `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tempPdfPath = path.join(tmpDir, `${prefijoPdf}.pdf`);

  // El nombre real del PNG se resuelve tras convertir (poppler rellena el número
  // de página con ceros según el total de páginas — ver resolverPngGenerado).
  let imgPathPrincipal: string | null = null;
  const tsvBasePath = path.join(tmpDir, `${prefijoPdf}_tsv`);
  const tsvPath = `${tsvBasePath}.tsv`;

  try {
    // 1. Escribir PDF temporal
    fs.writeFileSync(tempPdfPath, pdfBytes);

    // 2. OCR de la página principal (RFC + nombre)
    const popplerOptsPrincipal: import("pdf-poppler").ConvertOptions = {
      format: "png",
      out_dir: tmpDir,
      out_prefix: prefijoPdf,
      page: paginaIdx + 1,
      scale: escala,
    };

    await poppler.convert(tempPdfPath, popplerOptsPrincipal);

    imgPathPrincipal = resolverPngGenerado(tmpDir, prefijoPdf, paginaIdx + 1);
    if (imgPathPrincipal === null) {
      console.warn(`[ocr] No se generó imagen (prefijo ${prefijoPdf}) para página ${paginaIdx + 1}`);
      return { rfc: null, nombre: null, fecha: null };
    }

    // 3. OCR en texto plano (página principal)
    const tesseractConfig: TesseractConfig = { lang: "spa", oem: 1, psm: 3 };
    const textoPlano = await tesseract.recognize(imgPathPrincipal, tesseractConfig);
    const textoUpper = textoPlano.toUpperCase();

    // 4. Segundo pase OCR → TSV (posiciones por palabra, fallback para RFC)
    const tokensTSV: string[] = [];
    try {
      execSync(
        `tesseract "${imgPathPrincipal}" "${tsvBasePath}" -l spa --oem 1 --psm 3 tsv`,
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

    // 5. Extraer RFC y nombre de la página principal
    const rfc = extraerRFC(textoUpper, tokensTSV);
    const nombre = extraerNombre(textoPlano);

    if (rfc) console.log(`[ocr] RFC detectado: ${rfc}`);
    else console.warn("[ocr] No se detectó RFC");

    if (nombre) console.log(`[ocr] Nombre detectado: ${nombre}`);
    else console.warn("[ocr] No se detectó nombre en página principal");

    // 6. OCR de la página 4 (índice 3) para fecha de vigencia
    //    Se omite si: omitirOCRFecha=true, o si ya estamos en la página 4,
    //    o si el PDF tiene menos de 4 páginas (se maneja con try/catch).
    let fecha: Date | null = null;

    // Primero intentar extraer fecha del texto de la página principal (fallback rápido)
    fecha = extraerFecha(textoPlano);

    if (fecha === null && !omitirFecha && paginaIdx !== 3) {
      try {
        const textoPag4 = await ocrarPagina(
          tesseract,
          poppler,
          tempPdfPath,
          3, // índice 3 = página 4
          escala,
          tmpDir,
        );
        if (textoPag4.length > 0) {
          fecha = extraerFecha(textoPag4);
          if (fecha) console.log(`[ocr] Fecha detectada en pág 4: ${fecha.toISOString()}`);
          else console.warn("[ocr] No se detectó fecha en pág 4");
        }
      } catch (errPag4) {
        const msg = errPag4 instanceof Error ? errPag4.message : String(errPag4);
        console.warn(`[ocr] OCR pág 4 falló (fecha = null): ${msg}`);
      }
    } else if (fecha !== null) {
      console.log(`[ocr] Fecha detectada en página principal: ${fecha.toISOString()}`);
    }

    return { rfc, nombre, fecha };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[ocr] Error durante OCR: ${msg}`);
    return { rfc: null, nombre: null, fecha: null };
  } finally {
    // Limpiar temporales (errores de unlink no deben propagar)
    for (const p of [tempPdfPath, imgPathPrincipal, tsvPath]) {
      try {
        if (p !== null && fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // ignorar
      }
    }
  }
}
