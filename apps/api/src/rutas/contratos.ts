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
import fsSync from "node:fs";
import { prisma } from "../db.js";
import { procesarArchivo, type ResultadoProcesar } from "../servicios/procesarLote.js";
import { colaGlobal } from "../server.js";
import { qpdfDisponible, bloquear, desbloquear } from "@testado/pdf-core";

// ── Router ───────────────────────────────────────────────────────────────────

export const router = Router();

// ── Multer (memoria, solo PDF, máx 50 MB/archivo) ────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
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
          periodo > 4
        ) {
          res.status(400).json({
            success: false,
            message: "Los campos anio y periodo deben ser enteros válidos (periodo: 1–4).",
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
          const buf = archivo.buffer;
          const nombre = archivo.originalname;

          void colaGlobal
            .add(() =>
              procesarArchivo(buf, nombre, {
                trimestre,
                resolucionDuplicado,
              }),
            )
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

    let bloqueados = 0;
    const errores: Array<{ id: number; mensaje: string }> = [];

    for (const id of body.ids) {
      try {
        const contrato = await prisma.contrato.findUnique({
          where: { id, eliminado: false },
        });

        if (contrato === null) {
          errores.push({ id, mensaje: "Contrato no encontrado o eliminado." });
          continue;
        }

        const bytes = await fs.readFile(contrato.rutaArchivo);
        const cifrado = bloquear(bytes, ownerPwd);
        await fs.writeFile(contrato.rutaArchivo, cifrado);

        await prisma.contrato.update({
          where: { id },
          data: { estado: "BLOQUEADO", bloqueadoEn: new Date() },
        });

        bloqueados++;
      } catch (err: unknown) {
        const mensaje = err instanceof Error ? err.message : "Error desconocido.";
        errores.push({ id, mensaje });
      }
    }

    res.json({ success: true, bloqueados, errores });
  } catch (err: unknown) {
    const mensaje = err instanceof Error ? err.message : "Error interno del servidor.";
    res.status(500).json({ success: false, message: mensaje });
  }
});

// ── 5. POST /desbloquear ──────────────────────────────────────────────────────

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

    const ownerPwd = process.env["QPDF_OWNER_PASSWORD"];
    if (!ownerPwd) {
      res.status(500).json({
        success: false,
        message: "QPDF_OWNER_PASSWORD no está configurado en el servidor.",
      });
      return;
    }

    if (body.password !== ownerPwd) {
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

    let desbloqueados = 0;
    const errores: Array<{ id: number; mensaje: string }> = [];

    for (const id of body.ids) {
      try {
        const contrato = await prisma.contrato.findUnique({
          where: { id, eliminado: false },
        });

        if (contrato === null) {
          errores.push({ id, mensaje: "Contrato no encontrado o eliminado." });
          continue;
        }

        const bytes = await fs.readFile(contrato.rutaArchivo);
        const descifrado = desbloquear(bytes, ownerPwd);
        await fs.writeFile(contrato.rutaArchivo, descifrado);

        await prisma.contrato.update({
          where: { id },
          data: { estado: "DESBLOQUEADO", bloqueadoEn: null },
        });

        desbloqueados++;
      } catch (err: unknown) {
        const mensaje = err instanceof Error ? err.message : "Error desconocido.";
        errores.push({ id, mensaje });
      }
    }

    res.json({ success: true, desbloqueados, errores });
  } catch (err: unknown) {
    const mensaje = err instanceof Error ? err.message : "Error interno del servidor.";
    res.status(500).json({ success: false, message: mensaje });
  }
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
        empleado: { select: { rfc: true } },
        trimestre: { select: { anio: true, periodo: true } },
      },
    });

    if (contrato === null || contrato.eliminado) {
      res.status(404).json({ success: false, message: "Contrato no encontrado." });
      return;
    }

    // Verificar que el archivo existe en disco
    try {
      await fs.access(contrato.rutaArchivo);
    } catch {
      res.status(404).json({
        success: false,
        message: "El archivo PDF no se encontró en disco.",
      });
      return;
    }

    const descargar = req.query["descargar"] === "1";

    // Nombre de descarga legible: RFC_AAAATn.pdf
    const rfc = contrato.empleado.rfc.replace(/[^A-Z0-9\-_]/gi, "_");
    const nombreDescarga = `${rfc}_${contrato.trimestre.anio}T${contrato.trimestre.periodo}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      descargar
        ? `attachment; filename="${nombreDescarga}"`
        : `inline; filename="${nombreDescarga}"`,
    );

    // Transmitir el archivo
    const stream = fsSync.createReadStream(contrato.rutaArchivo);
    stream.pipe(res);

    stream.on("error", (err: Error) => {
      console.error(`[contratos] Error al transmitir PDF id=${idRaw}: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: "Error al leer el archivo." });
      }
    });
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
