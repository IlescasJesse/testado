/**
 * rutas/contratos.ts — Router de Express para la gestión de contratos PDF.
 *
 * Endpoints:
 *   POST   /testar              Procesa y testa archivos PDF en segundo plano.
 *   GET    /progreso?loteId=... Consulta el avance de un lote de procesamiento.
 *   GET    /                    Lista contratos con filtros opcionales.
 *   POST   /bloquear            Cifra contratos con qpdf (BLOQUEADO).
 *   POST   /desbloquear         Descifra contratos con qpdf (DESBLOQUEADO).
 *   POST   /:id/eliminar        Soft-delete de un contrato.
 *
 * DECISIÓN SOBRE TRANSACCIONES (Mejora A):
 *   procesarArchivo ya tiene manejo de errores completo y devuelve { estado: "error" }
 *   en lugar de lanzar. Refactorizar su lógica interna para usar prisma.$transaction
 *   requeriría cambios en procesarLote.ts y sus tests, que el plan indica no romper.
 *   Decisión: se deja procesarArchivo como está (sin transacción explícita) y se documenta.
 *   La atomicidad parcial (empleado creado pero contrato fallido) es aceptable porque:
 *     - El upsert de Empleado es idempotente por RFC.
 *     - El upsert de Trimestre es idempotente por anio+periodo.
 *     - Si create Contrato falla, en el próximo intento del mismo PDF se detecta por hash.
 *   En una iteración futura, se puede refactorizar procesarArchivo para aceptar un `tx`
 *   opcional y envolverlo en $transaction desde aquí.
 *
 * ENCOLADO (Mejora B):
 *   Cada archivo se procesa vía colaGlobal.add(() => procesarArchivo(...)) para
 *   respetar la concurrencia máxima definida por CONCURRENCIA (cpus-1). El endpoint
 *   POST /testar responde de inmediato con loteId y pone los procesarArchivo en cola.
 *
 * ESTRUCTURA DE LOTES EN MEMORIA:
 *   Map<loteId, EstadoLote> donde EstadoLote = { total, hechos: ResultadoProcesar[] }.
 *   loteId = `${Date.now()}-${contadorLotes++}` — único por proceso, no requiere UUID.
 *   Al completarse todos los archivos del lote, completado = (hechos.length === total).
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import type { ResultadoProcesar, ResultadoAccion } from "@testado/shared";
import { procesarArchivo } from "../servicios/procesarLote.js";
import { colaGlobal } from "../server.js";
import { qpdfDisponible, bloquear, desbloquear } from "@testado/pdf-core";

// ── Router ───────────────────────────────────────────────────────────────────

export const router = Router();

// ── Multer (disco, solo PDF, máx 50 MB/archivo) ──────────────────────────────
// Antes usaba memoryStorage: multer buffereaba TODOS los archivos del request
// en RAM antes de que el handler corriera, sin límite de cantidad. Con lotes
// grandes (muchos archivos y/o pesados) esto agotaba el heap de Node y tumbaba
// el proceso entero (el frontend veía "failed to fetch" porque el servidor
// moría a mitad de la subida). Con diskStorage cada archivo se escribe a un
// temporal vía streaming (memoria acotada) y cada uno se lee de a uno dentro
// de colaGlobal (concurrencia limitada), no todos de golpe.

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".pdf";
      cb(null, `testado_${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 1000 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error(`Solo se aceptan archivos PDF; recibido: ${file.originalname}`));
    }
  },
});

// ── Estado de lotes en memoria ────────────────────────────────────────────────

interface EstadoLote {
  total: number;
  hechos: ResultadoProcesar[];
}

const lotes = new Map<string, EstadoLote>();
let contadorLotes = 0;
let ultimoLoteId: string | null = null;

// ── Estado de lotes de bloqueo/desbloqueo en memoria (progreso contrato x contrato) ──
// Mismo patrón que `lotes` (POST /testar): el POST /bloquear o /desbloquear responde
// de inmediato con un loteId y procesa cada contrato en segundo plano vía colaGlobal;
// el frontend consulta /bloquear/progreso o /desbloquear/progreso para ir mostrando
// cada contrato según se resuelve, en vez de esperar una sola respuesta gigante que
// puede exceder timeouts del proxy de Next.js con lotes grandes.

interface EstadoLoteAccion {
  total: number;
  hechos: ResultadoAccion[];
}

const lotesAccion = new Map<string, EstadoLoteAccion>();
let contadorLotesAccion = 0;

// ── Interfaces para DTOs y bodies ─────────────────────────────────────────────

interface QueryListar {
  estado?: string;
  anio?: string;
  periodo?: string;
  rfc?: string;
}

interface BodyBloquear {
  ids?: unknown;
}

interface BodyDesbloquear {
  ids?: unknown;
  password?: unknown;
}

// ── Helper: escritura atómica (evita truncar un archivo que otra request ────
// pueda estar leyendo simultáneamente, p.ej. una descarga en curso). Escribe
// a un temporal en el mismo directorio y renombra: fs.rename es atómico en el
// mismo filesystem y libuv abre los file descriptors con FILE_SHARE_DELETE en
// Windows, por lo que un rename encima de un archivo con un read-stream ya
// abierto no lo corrompe — el lector en curso sigue viendo el contenido viejo
// completo hasta que cierra su fd.

async function escribirArchivoAtomico(rutaDestino: string, contenido: Buffer): Promise<void> {
  const rutaTemp = `${rutaDestino}.${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(rutaTemp, contenido);
  await fs.rename(rutaTemp, rutaDestino);
}

// ── Helper: valida que `ids` sea number[] no vacío ───────────────────────────

function validarIds(ids: unknown): ids is number[] {
  return (
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0)
  );
}

// ── 1. POST /testar ───────────────────────────────────────────────────────────

router.post(
  "/testar",
  upload.array("pdfs"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const archivos = req.files as Express.Multer.File[] | undefined;

      if (!archivos || archivos.length === 0) {
        res.status(400).json({ success: false, message: "No se enviaron archivos PDF." });
        return;
      }

      // Parámetros opcionales del body
      const anioRaw = req.body["anio"] as string | undefined;
      const periodoRaw = req.body["periodo"] as string | undefined;
      const resolucionDuplicado = req.body["resolucionDuplicado"] as
        | "omitir"
        | "reemplazar"
        | "version"
        | undefined;

      let trimestre: { anio: number; periodo: number } | undefined;

      if (anioRaw !== undefined && periodoRaw !== undefined) {
        const anio = parseInt(anioRaw, 10);
        const periodo = parseInt(periodoRaw, 10);

        if (
          !Number.isInteger(anio) ||
          !Number.isInteger(periodo) ||
          periodo < 1 ||
          periodo > 5
        ) {
          res.status(400).json({
            success: false,
            message: "Los campos anio y periodo deben ser enteros válidos (periodo: 1–5).",
          });
          return;
        }

        trimestre = { anio, periodo };
      }

      // Generar loteId único
      const loteId = `${Date.now()}-${contadorLotes++}`;
      ultimoLoteId = loteId;
      lotes.set(loteId, { total: archivos.length, hechos: [] });

      // Responder de inmediato
      res.json({ success: true, loteId, total: archivos.length, processing: true });

      // Procesar en segundo plano
      setImmediate(() => {
        const lote = lotes.get(loteId);
        if (lote === undefined) return;

        for (const archivo of archivos) {
          const rutaTemp = archivo.path;
          const nombre = archivo.originalname;

          void colaGlobal
            .add(async () => {
              const buf = await fs.readFile(rutaTemp);
              try {
                return await procesarArchivo(buf, nombre, {
                  trimestre,
                  resolucionDuplicado,
                });
              } finally {
                await fs.unlink(rutaTemp).catch(() => undefined);
              }
            })
            .then((resultado) => {
              lote.hechos.push(resultado);
            })
            .catch((err: unknown) => {
              const mensaje =
                err instanceof Error ? err.message : "Error desconocido en la cola.";
              lote.hechos.push({ estado: "error", mensaje });
            });
        }
      });
    } catch (err: unknown) {
      const mensaje = err instanceof Error ? err.message : "Error interno del servidor.";
      res.status(500).json({ success: false, message: mensaje });
    }
  },
);

// ── 2. GET /progreso ──────────────────────────────────────────────────────────

router.get("/progreso", (req: Request, res: Response): void => {
  try {
    const loteId = (req.query["loteId"] as string | undefined) ?? ultimoLoteId ?? "";
    const lote = lotes.get(loteId);

    if (lote === undefined) {
      res.json({ total: 0, hechos: [], completado: true });
      return;
    }

    res.json({
      total: lote.total,
      hechos: lote.hechos,
      completado: lote.hechos.length >= lote.total,
    });
  } catch (err: unknown) {
    const mensaje = err instanceof Error ? err.message : "Error interno del servidor.";
    res.status(500).json({ success: false, message: mensaje });
  }
});

// ── 3. GET / (listar contratos) ───────────────────────────────────────────────

router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query as QueryListar;

    const anio = query.anio !== undefined ? parseInt(query.anio, 10) : undefined;
    const periodo =
      query.periodo !== undefined ? parseInt(query.periodo, 10) : undefined;

    const contratos = await prisma.contrato.findMany({
      where: {
        eliminado: false,
        ...(query.estado !== undefined ? { estado: query.estado as "TESTADO" | "BLOQUEADO" | "DESBLOQUEADO" | "ERROR" } : {}),
        ...(anio !== undefined && !isNaN(anio) ? { trimestre: { anio } } : {}),
        ...(periodo !== undefined && !isNaN(periodo) ? { trimestre: { periodo } } : {}),
        ...(query.rfc !== undefined
          ? {
              empleado: {
                rfc: { contains: query.rfc },
              },
            }
          : {}),
      },
      include: {
        empleado: { select: { rfc: true, nombre: true } },
        trimestre: { select: { anio: true, periodo: true } },
      },
      orderBy: { procesadoEn: "desc" },
    });

    // Aplanar a ContratoDTO (campos planos como define @testado/shared)
    const dtos = contratos.map((c) => ({
      id: c.id,
      rfc: c.empleado.rfc,
      nombre: c.empleado.nombre,
      estado: c.estado,
      anio: c.trimestre.anio,
      periodo: c.trimestre.periodo,
      version: c.version,
      nombreArchivo: c.nombreArchivo,
      procesadoEn: c.procesadoEn.toISOString(),
      errorMsg: c.errorMsg,
    }));

    res.json({ success: true, contratos: dtos });
  } catch (err: unknown) {
    const mensaje = err instanceof Error ? err.message : "Error interno del servidor.";
    res.status(500).json({ success: false, message: mensaje });
  }
});

// ── 4. POST /bloquear ─────────────────────────────────────────────────────────
//
// Responde de inmediato con un loteId y cifra cada contrato en segundo plano
// (vía colaGlobal, mismo patrón que /testar). Evita una request única que
// bloquee minutos con lotes grandes y exceda el timeout del proxy de Next.js
// ("socket hang up"). El progreso contrato-por-contrato se consulta en
// GET /bloquear/progreso?loteId=...

router.post("/bloquear", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as BodyBloquear;

    if (!validarIds(body.ids)) {
      res.status(400).json({
        success: false,
        message: "El campo 'ids' debe ser un arreglo no vacío de enteros positivos.",
      });
      return;
    }

    if (!qpdfDisponible()) {
      res.status(409).json({
        success: false,
        message: "qpdf no está disponible; no se cifró nada",
      });
      return;
    }

    const ownerPwd = process.env["QPDF_OWNER_PASSWORD"];
    if (!ownerPwd) {
      res.status(500).json({
        success: false,
        message: "QPDF_OWNER_PASSWORD no está configurado en el servidor.",
      });
      return;
    }

    const ids = body.ids;
    const loteId = `bloq-${Date.now()}-${contadorLotesAccion++}`;
    lotesAccion.set(loteId, { total: ids.length, hechos: [] });

    res.json({ success: true, loteId, total: ids.length });

    setImmediate(() => {
      const lote = lotesAccion.get(loteId);
      if (lote === undefined) return;

      for (const id of ids) {
        void colaGlobal
          .add(async (): Promise<ResultadoAccion> => {
            const contrato = await prisma.contrato.findUnique({
              where: { id, eliminado: false },
              include: { empleado: { select: { rfc: true, nombre: true } } },
            });

            if (contrato === null) {
              return { id, ok: false, mensaje: "Contrato no encontrado o eliminado." };
            }

            // Salvaguarda: solo se cifra lo que está testado o desbloqueado.
            // Re-cifrar un BLOQUEADO aplicaría qpdf sobre un PDF ya cifrado y lo
            // corrompería; un ERROR no tiene un PDF censurado válido.
            if (contrato.estado !== "TESTADO" && contrato.estado !== "DESBLOQUEADO") {
              return {
                id,
                rfc: contrato.empleado.rfc,
                nombre: contrato.empleado.nombre,
                ok: false,
                mensaje: `Estado '${contrato.estado}' no bloqueable (solo TESTADO o DESBLOQUEADO).`,
              };
            }

            const bytes = await fs.readFile(contrato.rutaArchivo);
            const cifrado = bloquear(bytes, ownerPwd);
            await escribirArchivoAtomico(contrato.rutaArchivo, cifrado);

            await prisma.contrato.update({
              where: { id },
              data: { estado: "BLOQUEADO", bloqueadoEn: new Date() },
            });

            return { id, rfc: contrato.empleado.rfc, nombre: contrato.empleado.nombre, ok: true };
          })
          .then((resultado) => {
            lote.hechos.push(resultado);
          })
          .catch((err: unknown) => {
            const mensaje = err instanceof Error ? err.message : "Error desconocido.";
            lote.hechos.push({ id, ok: false, mensaje });
          });
      }
    });
  } catch (err: unknown) {
    const mensaje = err instanceof Error ? err.message : "Error interno del servidor.";
    res.status(500).json({ success: false, message: mensaje });
  }
});

// ── 4b. GET /bloquear/progreso ────────────────────────────────────────────────

router.get("/bloquear/progreso", (req: Request, res: Response): void => {
  const loteId = req.query["loteId"] as string | undefined;
  const lote = loteId !== undefined ? lotesAccion.get(loteId) : undefined;

  if (lote === undefined) {
    res.json({ total: 0, hechos: [], completado: true });
    return;
  }

  res.json({
    total: lote.total,
    hechos: lote.hechos,
    completado: lote.hechos.length >= lote.total,
  });
});

// ── 5. POST /desbloquear ──────────────────────────────────────────────────────
//
// Mismo patrón que /bloquear: la contraseña se valida de inmediato (síncrono),
// pero el descifrado de cada contrato corre en segundo plano con progreso vía
// GET /desbloquear/progreso?loteId=...

router.post("/desbloquear", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as BodyDesbloquear;

    if (typeof body.password !== "string" || body.password.trim() === "") {
      res.status(400).json({
        success: false,
        message: "Se requiere el campo 'password'.",
      });
      return;
    }

    const ownerPwdRaw = process.env["QPDF_OWNER_PASSWORD"];
    if (!ownerPwdRaw) {
      res.status(500).json({
        success: false,
        message: "QPDF_OWNER_PASSWORD no está configurado en el servidor.",
      });
      return;
    }
    const ownerPwd = ownerPwdRaw.trim();

    if (body.password.trim() !== ownerPwd) {
      res.status(401).json({
        success: false,
        message: "Contraseña incorrecta.",
      });
      return;
    }

    if (!validarIds(body.ids)) {
      res.status(400).json({
        success: false,
        message: "El campo 'ids' debe ser un arreglo no vacío de enteros positivos.",
      });
      return;
    }

    const ids = body.ids;
    const loteId = `desb-${Date.now()}-${contadorLotesAccion++}`;
    lotesAccion.set(loteId, { total: ids.length, hechos: [] });

    res.json({ success: true, loteId, total: ids.length });

    setImmediate(() => {
      const lote = lotesAccion.get(loteId);
      if (lote === undefined) return;

      for (const id of ids) {
        void colaGlobal
          .add(async (): Promise<ResultadoAccion> => {
            const contrato = await prisma.contrato.findUnique({
              where: { id, eliminado: false },
              include: { empleado: { select: { rfc: true, nombre: true } } },
            });

            if (contrato === null) {
              return { id, ok: false, mensaje: "Contrato no encontrado o eliminado." };
            }

            const bytes = await fs.readFile(contrato.rutaArchivo);
            const descifrado = desbloquear(bytes, ownerPwd);
            await escribirArchivoAtomico(contrato.rutaArchivo, descifrado);

            await prisma.contrato.update({
              where: { id },
              data: { estado: "DESBLOQUEADO", bloqueadoEn: null },
            });

            return { id, rfc: contrato.empleado.rfc, nombre: contrato.empleado.nombre, ok: true };
          })
          .then((resultado) => {
            lote.hechos.push(resultado);
          })
          .catch((err: unknown) => {
            const mensaje = err instanceof Error ? err.message : "Error desconocido.";
            lote.hechos.push({ id, ok: false, mensaje });
          });
      }
    });
  } catch (err: unknown) {
    const mensaje = err instanceof Error ? err.message : "Error interno del servidor.";
    res.status(500).json({ success: false, message: mensaje });
  }
});

// ── 5b. GET /desbloquear/progreso ─────────────────────────────────────────────

router.get("/desbloquear/progreso", (req: Request, res: Response): void => {
  const loteId = req.query["loteId"] as string | undefined;
  const lote = loteId !== undefined ? lotesAccion.get(loteId) : undefined;

  if (lote === undefined) {
    res.json({ total: 0, hechos: [], completado: true });
    return;
  }

  res.json({
    total: lote.total,
    hechos: lote.hechos,
    completado: lote.hechos.length >= lote.total,
  });
});

// ── 6. GET /:id/archivo — ver o descargar el PDF censurado ───────────────────
//
// Por defecto sirve el PDF inline (para visor en navegador).
// Con query ?descargar=1 usa Content-Disposition attachment con nombre legible.
//
// Respuestas:
//   200: stream del PDF con Content-Type application/pdf
//   400: id inválido
//   404: contrato no encontrado / eliminado / archivo no existe en disco
//   500: error inesperado al leer el archivo

router.get("/:id/archivo", async (req: Request, res: Response): Promise<void> => {
  try {
    const idParam = req.params["id"];
    const idRaw = parseInt(typeof idParam === "string" ? idParam : "", 10);

    if (!Number.isInteger(idRaw) || idRaw <= 0) {
      res.status(400).json({ success: false, message: "ID de contrato inválido." });
      return;
    }

    const contrato = await prisma.contrato.findUnique({
      where: { id: idRaw },
      include: {
        empleado: { select: { rfc: true, nombre: true } },
        trimestre: { select: { anio: true, periodo: true } },
      },
    });

    if (contrato === null || contrato.eliminado) {
      res.status(404).json({ success: false, message: "Contrato no encontrado." });
      return;
    }

    // Se lee el archivo COMPLETO a memoria antes de responder (en vez de stream)
    // y se manda de una sola vez con res.end(buffer). Así Content-Length es
    // exacto desde el primer byte de la respuesta — Chrome conoce el peso real
    // de inmediato y muestra un tiempo de espera real en vez de "Reanudando...".
    // Con un stream, cualquier micro-corte de la conexión (p.ej. mientras el
    // proceso hace otra tarea pesada) deja a Chrome sin saber si el archivo
    // sigue llegando o se cortó, y reintenta con Range — que este endpoint no
    // soporta — quedándose en "Reanudando" indefinidamente. Por eso también se
    // manda "Accept-Ranges: none": le dice al navegador explícitamente que no
    // intente descargas parciales/reanudables contra este endpoint.
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(contrato.rutaArchivo);
    } catch {
      res.status(404).json({
        success: false,
        message: "El archivo PDF no se encontró en disco.",
      });
      return;
    }

    const descargar = req.query["descargar"] === "1";

    // Nombre de descarga legible: NOMBRE COMPLETO.pdf (apellido paterno, apellido
    // materno, nombres — orden ya extraído por OCR). Sin RFC. Si no hay nombre
    // detectado, se usa el RFC como respaldo para no dejar el archivo sin nombre.
    const baseNombre = (contrato.empleado.nombre ?? contrato.empleado.rfc)
      .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 _-]/g, "")
      .trim();
    const nombreDescarga = `${baseNombre}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", bytes.length);
    res.setHeader("Accept-Ranges", "none");
    res.setHeader(
      "Content-Disposition",
      descargar
        ? `attachment; filename="${nombreDescarga}"`
        : `inline; filename="${nombreDescarga}"`,
    );

    res.end(bytes);
  } catch (err: unknown) {
    const mensaje = err instanceof Error ? err.message : "Error interno del servidor.";
    res.status(500).json({ success: false, message: mensaje });
  }
});

// ── 7. POST /:id/eliminar (soft delete) ───────────────────────────────────────

router.post("/:id/eliminar", async (req: Request, res: Response): Promise<void> => {
  try {
    const idParam = req.params["id"];
    const idRaw = parseInt(typeof idParam === "string" ? idParam : "", 10);

    if (!Number.isInteger(idRaw) || idRaw <= 0) {
      res.status(400).json({ success: false, message: "ID de contrato inválido." });
      return;
    }

    const contrato = await prisma.contrato.findUnique({
      where: { id: idRaw },
    });

    if (contrato === null || contrato.eliminado) {
      res.status(404).json({ success: false, message: "Contrato no encontrado." });
      return;
    }

    await prisma.contrato.update({
      where: { id: idRaw },
      data: { eliminado: true },
    });

    res.json({ success: true });
  } catch (err: unknown) {
    const mensaje = err instanceof Error ? err.message : "Error interno del servidor.";
    res.status(500).json({ success: false, message: mensaje });
  }
});

export default router;
