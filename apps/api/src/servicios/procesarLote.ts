/**
 * procesarLote.ts — Servicio de procesamiento de archivos PDF de contratos.
 *
 * Responsabilidades:
 *   1. Cache por hash SHA-256: si el PDF ya fue procesado, devuelve datos existentes sin re-OCR.
 *   2. Censura vía testarPdf (OCR + recuadros negros).
 *   3. Derivación automática de trimestre desde la fecha detectada por OCR.
 *   4. Detección de duplicados (mismo empleado+trimestre ya tiene contrato activo).
 *   5. Escritura del PDF censurado a disco en ruta estructurada.
 *   6. Persistencia en BD (upsert Empleado, upsert Trimestre, create Contrato).
 *
 * DECISIONES DE DISEÑO documentadas:
 *
 * A) RFC nulo → pseudo-RFC
 *    Si el OCR no detecta RFC, se genera `SINRFC-<primeros 8 chars del hash>`.
 *    Esto preserva el constraint UNIQUE de Empleado.rfc y permite correlacionar
 *    el registro con el archivo si se reprocesa. El nombre se toma del nombreArchivo
 *    sin extensión como fallback.
 *
 * B) Resolución "reemplazar"
 *    Se aplica soft-delete (eliminado=true) a TODAS las versiones previas no
 *    eliminadas del empleado+trimestre, y se crea un nuevo Contrato con
 *    version = max(versiones previas) + 1. Esto preserva el historial y
 *    mantiene el unique constraint [empleadoId, trimestreId, version].
 *
 * C) Guardado de archivos en tests
 *    En tests se mockea el módulo "node:fs/promises" completo. El mock intercepta
 *    mkdir y writeFile para no tocar disco real. Se documenta en el test file.
 *
 * D) Ruta de salida
 *    DIR_SALIDA apunta a <raíz-repo>/tested_Censurado.
 *    Subdirectorio: tested_Censurado/{anio}/T{periodo}/{RFC_sanitizado}_v{n}.pdf
 *    __dirname apunta a apps/api/src/servicios en tiempo de ejecución.
 *    Se sube 4 niveles para llegar a la raíz del monorepo.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { calcularHash, trimestreDeFecha, testarPdf, nombreDesdeArchivo } from "@testado/pdf-core";
import type { ResultadoProcesar } from "@testado/shared";
import { prisma } from "../db.js";

/** Elimina acentos/diacríticos para comparación insensible a acentos. */
function normalizarParaComparacion(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Ruta base de salida ───────────────────────────────────────────────────────
// apps/api/src/servicios/ → sube 4 niveles → raíz del monorepo
const DIR_SALIDA = path.resolve(__dirname, "../../../../tested_Censurado");

// ── Interfaces públicas ───────────────────────────────────────────────────────

export interface OpcionesProcesar {
  /** Trimestre ya confirmado por el usuario. */
  trimestre?: { anio: number; periodo: number };
  /** Qué hacer si ya existe un contrato activo para ese empleado+trimestre. */
  resolucionDuplicado?: "omitir" | "reemplazar" | "version";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sanitiza un RFC para usarlo como parte de un nombre de archivo. */
function sanitizarParaNombreArchivo(rfc: string): string {
  return rfc.replace(/[^A-Z0-9\-_]/gi, "_");
}

/**
 * Deriva un pseudo-RFC a partir del hash cuando el OCR no detectó RFC real.
 * Formato: SINRFC-XXXXXXXX (8 primeros caracteres hex del hash).
 */
function pseudoRfc(hash: string): string {
  return `SINRFC-${hash.slice(0, 8).toUpperCase()}`;
}

// ── Función principal ─────────────────────────────────────────────────────────

/**
 * Procesa un archivo PDF de contrato:
 *   - Verifica cache por hash (evita re-OCR si el archivo ya fue procesado).
 *   - Ejecuta censura OCR si no hay cache.
 *   - Determina el trimestre.
 *   - Detecta duplicados (mismo empleado+trimestre).
 *   - Persiste Empleado, Trimestre y Contrato en BD.
 *   - Escribe el PDF censurado a disco.
 *
 * Ante error inesperado devuelve `{ estado: "error", mensaje }` — no lanza.
 */
export async function procesarArchivo(
  buf: Buffer,
  nombreArchivo: string,
  opts?: OpcionesProcesar,
): Promise<ResultadoProcesar> {
  try {
    // ── 1. Hash ───────────────────────────────────────────────────────────────
    const hash = calcularHash(buf);

    // ── 2. Cache: buscar contrato existente con el mismo hash ─────────────────
    const contratoEnCache = await prisma.contrato.findFirst({
      where: { hash, eliminado: false },
      include: { empleado: true, trimestre: true },
    });

    if (contratoEnCache !== null) {
      return {
        estado: "cache",
        contratoId: contratoEnCache.id,
        rfc: contratoEnCache.rfcDetectado ?? contratoEnCache.empleado.rfc,
        nombre: contratoEnCache.empleado.nombre ?? null,
        trimestre: {
          anio: contratoEnCache.trimestre.anio,
          periodo: contratoEnCache.trimestre.periodo,
        },
        version: contratoEnCache.version,
        mensaje: "Archivo ya procesado anteriormente (cache por hash).",
      };
    }

    // ── 3. OCR + censura ──────────────────────────────────────────────────────
    const { bytes: bytesCensurados, rfc: rfcDetectado, nombre: nombreDetectado, fecha: fechaDetectada } =
      await testarPdf(buf);

    // ── 4. Determinar trimestre ───────────────────────────────────────────────
    let trimestreElegido: { anio: number; periodo: number };

    if (opts?.trimestre !== undefined) {
      trimestreElegido = opts.trimestre;
    } else if (fechaDetectada !== null) {
      const derivado = trimestreDeFecha(fechaDetectada);
      trimestreElegido = derivado;
    } else {
      return {
        estado: "error",
        mensaje:
          "No se pudo determinar el trimestre: el PDF no contiene fecha y no se especificó uno.",
      };
    }

    // ── 5. RFC efectivo y nombre de empleado ──────────────────────────────────
    const rfcEfectivo = rfcDetectado ?? pseudoRfc(hash);

    // Cross-check: nombre OCR vs. nombre del archivo.
    //
    // El nombre del archivo es considerado fiable (el usuario lo nombra).
    // Si el OCR detectó un nombre, se compara (normalizado) con el del archivo:
    //   - Si coinciden (mismas palabras, independiente del orden) → usar OCR.
    //   - Si difieren → priorizar el nombre del ARCHIVO y registrar advertencia.
    //   - Si OCR no detectó nada → usar el nombre del archivo (nunca vacío).
    const nombreArchivonorm = nombreDesdeArchivo(nombreArchivo);
    let nombreEfectivo: string;

    if (nombreDetectado !== null) {
      const ocrNorm = nombreDetectado.toUpperCase().replace(/\s+/g, " ").trim();
      // Normalizar sin acentos para comparación laxa (insensible a diacríticos)
      const ocrSinAcentos = normalizarParaComparacion(ocrNorm);
      const archivoSinAcentos = normalizarParaComparacion(nombreArchivonorm);
      const palabrasOcr = new Set(ocrSinAcentos.split(/\s+/));
      const palabrasArchivo = new Set(archivoSinAcentos.split(/\s+/));
      // Coincidencia laxa: todas las palabras del nombre más corto están en el más largo
      const minPalabras = Math.min(palabrasOcr.size, palabrasArchivo.size);
      const coincidencias = [...palabrasOcr].filter((p) => palabrasArchivo.has(p)).length;
      const coincide = minPalabras > 0 && coincidencias >= minPalabras;

      if (coincide) {
        // OCR y archivo coinciden: usar OCR (fuente directa del documento)
        nombreEfectivo = ocrNorm;
      } else {
        // Difieren: priorizar nombre del archivo (más confiable) y advertir
        console.warn(
          `[procesarLote] Nombre OCR "${ocrNorm}" difiere del archivo "${nombreArchivonorm}". ` +
            `Se usa nombre del archivo.`,
        );
        nombreEfectivo = nombreArchivonorm;
      }
    } else {
      // Sin OCR: nombre del archivo como fallback garantizado
      nombreEfectivo = nombreArchivonorm;
    }

    // Upsert Empleado: crear si no existe; actualizar nombre si se detectó uno nuevo
    const empleado = await prisma.empleado.upsert({
      where: { rfc: rfcEfectivo },
      create: { rfc: rfcEfectivo, nombre: nombreEfectivo },
      update: nombreDetectado !== null ? { nombre: nombreDetectado } : {},
    });

    // ── 6. Upsert Trimestre ───────────────────────────────────────────────────
    const trimestre = await prisma.trimestre.upsert({
      where: {
        anio_periodo: {
          anio: trimestreElegido.anio,
          periodo: trimestreElegido.periodo,
        },
      },
      create: { anio: trimestreElegido.anio, periodo: trimestreElegido.periodo },
      update: {},
    });

    // ── 7. Duplicado: ¿ya existe contrato activo para empleado+trimestre? ─────
    const contratosPrevios = await prisma.contrato.findMany({
      where: {
        empleadoId: empleado.id,
        trimestreId: trimestre.id,
        eliminado: false,
      },
      orderBy: { version: "asc" },
    });

    // Obtener la máxima versión global (incluyendo soft-deleteados) para evitar
    // unique constraint violation @@unique([empleadoId, trimestreId, version])
    const maxVersionGlobal = await prisma.contrato.aggregate({
      where: { empleadoId: empleado.id, trimestreId: trimestre.id },
      _max: { version: true },
    });
    const proximaVersion = (maxVersionGlobal._max.version ?? 0) + 1;

    const hayDuplicado = contratosPrevios.length > 0;

    if (hayDuplicado) {
      const resolucion = opts?.resolucionDuplicado;

      if (resolucion === undefined) {
        // Sin resolución explícita → pedir confirmación al frontend
        const versionActual = contratosPrevios[contratosPrevios.length - 1]?.version ?? 1;
        return {
          estado: "duplicado",
          rfc: rfcEfectivo,
          nombre: nombreEfectivo,
          trimestre: trimestreElegido,
          version: versionActual,
          mensaje:
            `Ya existe un contrato (versión ${versionActual}) para este empleado en el trimestre ` +
            `${trimestreElegido.anio}-T${trimestreElegido.periodo}. ` +
            `Especifique resolucionDuplicado: "omitir" | "reemplazar" | "version".`,
        };
      }

      if (resolucion === "omitir") {
        return {
          estado: "duplicado",
          rfc: rfcEfectivo,
          nombre: nombreEfectivo,
          trimestre: trimestreElegido,
          mensaje: "Duplicado omitido por instrucción del usuario.",
        };
      }

      if (resolucion === "reemplazar") {
        // Soft-delete de todas las versiones previas activas
        await prisma.contrato.updateMany({
          where: {
            empleadoId: empleado.id,
            trimestreId: trimestre.id,
            eliminado: false,
          },
          data: { eliminado: true },
        });
      }

      // Para "version" y "reemplazar" se crea el nuevo contrato abajo
      const rfcSanitizado = sanitizarParaNombreArchivo(rfcEfectivo);
      const rutaRelativa = path.join(
        String(trimestreElegido.anio),
        `T${trimestreElegido.periodo}`,
        `${rfcSanitizado}_v${proximaVersion}.pdf`,
      );
      const rutaAbsoluta = path.join(DIR_SALIDA, rutaRelativa);

      await fs.mkdir(path.dirname(rutaAbsoluta), { recursive: true });
      await fs.writeFile(rutaAbsoluta, bytesCensurados);

      const nuevoContrato = await prisma.contrato.create({
        data: {
          empleadoId: empleado.id,
          trimestreId: trimestre.id,
          hash,
          nombreArchivo,
          rutaArchivo: rutaAbsoluta,
          estado: "TESTADO",
          version: proximaVersion,
          rfcDetectado: rfcDetectado,
          fechaContrato: fechaDetectada,
        },
      });

      return {
        estado: "testado",
        contratoId: nuevoContrato.id,
        rfc: rfcEfectivo,
        nombre: nombreEfectivo,
        trimestre: trimestreElegido,
        version: proximaVersion,
      };
    }

    // ── 8. Caso limpio: primera versión (usa proximaVersion global) ──────────
    const rfcSanitizado = sanitizarParaNombreArchivo(rfcEfectivo);
    const rutaRelativa = path.join(
      String(trimestreElegido.anio),
      `T${trimestreElegido.periodo}`,
      `${rfcSanitizado}_v${proximaVersion}.pdf`,
    );
    const rutaAbsoluta = path.join(DIR_SALIDA, rutaRelativa);

    await fs.mkdir(path.dirname(rutaAbsoluta), { recursive: true });
    await fs.writeFile(rutaAbsoluta, bytesCensurados);

    const contrato = await prisma.contrato.create({
      data: {
        empleadoId: empleado.id,
        trimestreId: trimestre.id,
        hash,
        nombreArchivo,
        rutaArchivo: rutaAbsoluta,
        estado: "TESTADO",
        version: proximaVersion,
        rfcDetectado: rfcDetectado,
        fechaContrato: fechaDetectada,
      },
    });

    // ── 9. Resultado exitoso ──────────────────────────────────────────────────
    return {
      estado: "testado",
      contratoId: contrato.id,
      rfc: rfcEfectivo,
      nombre: nombreEfectivo,
      trimestre: trimestreElegido,
      version: proximaVersion,
    };
  } catch (err: unknown) {
    const mensaje =
      err instanceof Error ? err.message : "Error desconocido al procesar el archivo.";
    return { estado: "error", mensaje };
  }
}
