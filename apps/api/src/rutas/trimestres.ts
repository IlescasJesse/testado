/**
 * rutas/trimestres.ts — Router de Express para consulta de trimestres y descarga de respaldo ZIP.
 *
 * Endpoints:
 *   GET /                        Lista trimestres no vacíos con conteos por estado.
 *   GET /:anio/:periodo/respaldo Genera y transmite un ZIP con los PDFs BLOQUEADOS del trimestre.
 *
 * ESTRATEGIA DE CONTEOS (GET /):
 *   Se usa prisma.contrato.groupBy con by: ["trimestreId", "estado"] para agregar en BD.
 *   Esto evita traer todos los contratos a memoria. Luego se cruzan los resultados con
 *   prisma.trimestre.findMany para obtener anio/periodo. El groupBy de Prisma no filtra
 *   trimestres vacíos por sí solo (solo aparecen combinaciones con al menos 1 contrato),
 *   por lo que los trimestres sin contratos simplemente no aparecen en el resultado.
 *   Orden: por anio desc, periodo desc (aplicado en JS sobre el array final).
 *
 * ESTRATEGIA DE ZIP (GET /:anio/:periodo/respaldo):
 *   Se usa archiver v7 ("zip", nivel 9). Solo se incluyen contratos con estado BLOQUEADO
 *   y eliminado: false. Si no hay contratos bloqueados, se responde con un ZIP que contiene
 *   un archivo LEEME.txt indicando la ausencia — esto evita devolver 500 o 404 y permite
 *   al cliente recibir siempre un ZIP válido.
 *   Se incluye siempre un manifiesto.txt listando RFC, nombre y version de cada contrato incluido.
 */

import { Router, Request, Response } from "express";
// archiver es un módulo CJS. Con esModuleInterop=true y NodeNext en modo CJS,
// la importación default funciona en runtime pero TypeScript no infiere que es
// callable desde los tipos de @types/archiver (que no declaran export =).
// Se importa como namespace y se hace el cast mínimo necesario.
import * as archiverNs from "archiver";
import type { Archiver, ArchiverOptions } from "archiver";
import type { ResumenTrimestre } from "@testado/shared";
import fs from "node:fs";
import { prisma } from "../db.js";

// El módulo archiver exporta una función factory como su valor principal.
// Con esModuleInterop el default import en runtime es esa función.
const archiverFactory = (archiverNs as unknown as {
  default: (format: string, options?: ArchiverOptions) => Archiver;
}).default ?? (archiverNs as unknown as (format: string, options?: ArchiverOptions) => Archiver);

export const router = Router();

// ── Tipos auxiliares ──────────────────────────────────────────────────────────

/** Resultado de groupBy contrato por trimestreId + estado */
interface GrupoContrato {
  trimestreId: number;
  estado: "TESTADO" | "BLOQUEADO" | "DESBLOQUEADO" | "ERROR";
  _count: { _all: number };
}

// ── 1. GET / — Lista trimestres con conteos por estado ────────────────────────

router.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    // Agrega en BD: número de contratos por (trimestreId, estado), excluyendo eliminados.
    // Se hace doble cast (unknown → tipo propio) porque el tipo devuelto por Prisma
    // groupBy es genérico y no coincide directamente con GrupoContrato sin el cast.
    const gruposRaw = await prisma.contrato.groupBy({
      by: ["trimestreId", "estado"],
      where: { eliminado: false },
      _count: { _all: true },
    });
    const grupos = gruposRaw as unknown as GrupoContrato[];

    if (grupos.length === 0) {
      res.json({ success: true, trimestres: [] });
      return;
    }

    // Obtener los ids únicos de trimestre presentes
    const idsUnicos = [...new Set(grupos.map((g) => g.trimestreId))];

    const trimestres = await prisma.trimestre.findMany({
      where: { id: { in: idsUnicos } },
      select: { id: true, anio: true, periodo: true },
    });

    // Indexar trimestres por id para lookup O(1)
    const mapaTrimestres = new Map(trimestres.map((t) => [t.id, t]));

    // Acumular conteos por trimestreId
    const mapaConteos = new Map<number, ResumenTrimestre>();

    for (const grupo of grupos) {
      const trim = mapaTrimestres.get(grupo.trimestreId);
      if (trim === undefined) continue;

      if (!mapaConteos.has(grupo.trimestreId)) {
        mapaConteos.set(grupo.trimestreId, {
          anio: trim.anio,
          periodo: trim.periodo,
          total: 0,
          testados: 0,
          bloqueados: 0,
          desbloqueados: 0,
          errores: 0,
        });
      }

      const resumen = mapaConteos.get(grupo.trimestreId)!;
      const cantidad = grupo._count._all;
      resumen.total += cantidad;

      switch (grupo.estado) {
        case "TESTADO":
          resumen.testados += cantidad;
          break;
        case "BLOQUEADO":
          resumen.bloqueados += cantidad;
          break;
        case "DESBLOQUEADO":
          resumen.desbloqueados += cantidad;
          break;
        case "ERROR":
          resumen.errores += cantidad;
          break;
      }
    }

    // Ordenar por anio desc, periodo desc
    const resultado = [...mapaConteos.values()].sort((a, b) => {
      if (b.anio !== a.anio) return b.anio - a.anio;
      return b.periodo - a.periodo;
    });

    res.json({ success: true, trimestres: resultado });
  } catch (err: unknown) {
    const mensaje = err instanceof Error ? err.message : "Error interno del servidor.";
    res.status(500).json({ success: false, message: mensaje });
  }
});

// ── 2. GET /:anio/:periodo/respaldo — Descarga ZIP de PDFs BLOQUEADOS ─────────

router.get("/:anio/:periodo/respaldo", async (req: Request, res: Response): Promise<void> => {
  try {
    // Validar parámetros de ruta (cast a string — Express los inyecta siempre como string)
    const anioRaw = String(req.params["anio"] ?? "");
    const periodoRaw = String(req.params["periodo"] ?? "");

    const anio = parseInt(anioRaw, 10);
    const periodo = parseInt(periodoRaw, 10);

    if (
      !Number.isInteger(anio) ||
      isNaN(anio) ||
      !Number.isInteger(periodo) ||
      isNaN(periodo) ||
      periodo < 1 ||
      periodo > 5
    ) {
      res.status(400).json({
        success: false,
        message:
          "Los parámetros anio y periodo deben ser enteros válidos (periodo: 1–5).",
      });
      return;
    }

    // Consultar contratos del trimestre (bloqueados o desbloqueados, no eliminados)
    const contratos = await prisma.contrato.findMany({
      where: {
        eliminado: false,
        estado: { in: ["BLOQUEADO", "DESBLOQUEADO"] },
        trimestre: { anio, periodo },
      },
      include: {
        empleado: { select: { rfc: true, nombre: true } },
      },
      orderBy: { procesadoEn: "asc" },
    });

    // Preparar headers y stream ZIP
    res.attachment(`respaldo_${anio}_T${periodo}.zip`);
    res.setHeader("Content-Type", "application/zip");

    const archive = archiverFactory("zip", { zlib: { level: 9 } });

    // Propagar errores de archiver al cliente (sin lanzar)
    archive.on("error", (err: Error) => {
      // Si ya se enviaron headers no podemos cambiar el código, pero al menos
      // finalizamos la respuesta para no dejar al cliente colgado.
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: err.message });
      } else {
        res.end();
      }
    });

    archive.pipe(res);

    if (contratos.length === 0) {
      // ZIP vacío con LEEME.txt — el cliente recibe siempre un ZIP válido
      archive.append(
        `No hay contratos bloqueados o desbloqueados en el trimestre ${anio} T${periodo}.\n`,
        { name: "LEEME.txt" },
      );
    } else {
      // Agregar cada PDF bloqueado al ZIP
      const lineasManifiesto: string[] = [
        `Manifiesto de respaldo — Trimestre ${anio} T${periodo} (bloqueados y desbloqueados)`,
        `Generado: ${new Date().toISOString()}`,
        "─────────────────────────────────────────",
      ];

      for (const contrato of contratos) {
        const rfc = contrato.empleado.rfc;
        const nombre = contrato.empleado.nombre ?? "SIN_NOMBRE";
        const version = contrato.version;
        const nombreArchivo = contrato.nombreArchivo;

        // Nombre legible en el ZIP: RFC_nombreOriginal (o RFC_vN.pdf si nombreArchivo vacío)
        const nombreEnZip = nombreArchivo
          ? `${rfc}_${nombreArchivo}`
          : `${rfc}_v${version}.pdf`;

        // Solo agregar si el archivo existe en disco
        if (fs.existsSync(contrato.rutaArchivo)) {
          archive.file(contrato.rutaArchivo, { name: nombreEnZip });
          lineasManifiesto.push(`${rfc} | ${nombre} | v${version} | ${nombreEnZip}`);
        } else {
          lineasManifiesto.push(
            `${rfc} | ${nombre} | v${version} | ARCHIVO_NO_ENCONTRADO (${contrato.rutaArchivo})`,
          );
        }
      }

      // Manifiesto siempre presente
      archive.append(lineasManifiesto.join("\n") + "\n", { name: "manifiesto.txt" });
    }

    await archive.finalize();
  } catch (err: unknown) {
    const mensaje = err instanceof Error ? err.message : "Error interno del servidor.";
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: mensaje });
    } else {
      res.end();
    }
  }
});

export default router;
