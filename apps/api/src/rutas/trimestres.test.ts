/**
 * trimestres.test.ts — Tests del router de trimestres.
 *
 * ESTRATEGIA DE MOCK:
 *
 * 1. ../db.js (prisma)
 *    Mockeado para no requerir BD real.
 *    - prisma.contrato.groupBy → simula grupos por (trimestreId, estado).
 *    - prisma.trimestre.findMany → devuelve { id, anio, periodo }.
 *    - prisma.contrato.findMany → devuelve lista de contratos BLOQUEADOS.
 *
 * 2. archiver
 *    Mockeado con un objeto fake que implementa las operaciones que usa el router:
 *    pipe(), append(), file(), finalize(), on(). Se captura como variable de módulo
 *    para poder inspeccionarla post-request.
 *    DECISIÓN: archiver es un módulo CJS; vi.mock intercepta su default export.
 *    El factory recibe un spy que devuelve el fakeArchive cada vez que se llama.
 *    Esto permite verificar que se llamó append/file/finalize sin escribir en disco.
 *
 * 3. node:fs
 *    fs.existsSync mockeado para controlar qué rutas "existen" en disco.
 *
 * NOTA: Express 5 propaga errores async via next(err). En este router todos los
 * handlers usan try/catch explícito, por lo que supertest captura respuestas correctamente.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
// ── Fake archive compartido entre tests ───────────────────────────────────────

/**
 * Tipo mínimo del archive fake. No extiende EventEmitter para evitar conflictos
 * de tipos con el mock de vi.fn() — el router solo usa las operaciones listadas.
 */
interface FakeArchive {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipe: ReturnType<typeof vi.fn<any[], any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  append: ReturnType<typeof vi.fn<any[], any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  file: ReturnType<typeof vi.fn<any[], any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  finalize: ReturnType<typeof vi.fn<any[], any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: ReturnType<typeof vi.fn<any[], any>>;
  _pipedTo?: NodeJS.WritableStream;
}

const fakeArchive: FakeArchive = {
  // pipe guarda el destino para que finalize pueda cerrarlo
  pipe: vi.fn(),
  append: vi.fn(),
  file: vi.fn(),
  finalize: vi.fn(),
  on: vi.fn(),
};

// ── Mocks de módulos ──────────────────────────────────────────────────────────
// vi.mock se eleva automáticamente al tope por Vitest.

vi.mock("archiver", () => {
  // El default export de archiver es una función factory que devuelve el archive.
  const archiverFactory = vi.fn(() => fakeArchive);
  return { default: archiverFactory };
});

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
  },
  existsSync: vi.fn(() => true),
}));

vi.mock("../db.js", () => ({
  prisma: {
    contrato: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    trimestre: {
      findMany: vi.fn(),
    },
  },
}));

// ── Importaciones (después de los mocks) ──────────────────────────────────────

import request from "supertest";
import express from "express";
import { router } from "./trimestres.js";
import { prisma } from "../db.js";
import fs from "node:fs";

// ── App de prueba ──────────────────────────────────────────────────────────────

function crearApp(): ReturnType<typeof express> {
  const app = express();
  app.use(express.json());
  app.use("/api/trimestres", router);
  return app;
}

// ── Aliases tipados para mocks ─────────────────────────────────────────────────

const mockContrato = prisma.contrato as unknown as {
  groupBy: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};

const mockTrimestre = prisma.trimestre as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};

const mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Restablecer _pipedTo para cada test
  fakeArchive._pipedTo = undefined;

  // pipe: captura el destino (la respuesta HTTP) para que finalize pueda cerrarlo.
  // Esto es necesario porque el fake no escribe bytes reales — supertest esperaría
  // indefinidamente si el stream no se cierra explícitamente.
  fakeArchive.pipe.mockImplementation((dest: unknown) => {
    fakeArchive._pipedTo = dest as NodeJS.WritableStream;
  });

  // finalize: termina el stream destino para desbloquear supertest.
  fakeArchive.finalize.mockImplementation(() => {
    return Promise.resolve().then(() => {
      if (fakeArchive._pipedTo) {
        fakeArchive._pipedTo.end();
      }
    });
  });

  // existsSync devuelve true por defecto
  mockExistsSync.mockReturnValue(true);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("GET /api/trimestres", () => {
  it("devuelve lista de trimestres con conteos correctos por estado", async () => {
    const app = crearApp();

    // groupBy devuelve 3 grupos del mismo trimestre (id=1, anio=2024, periodo=1)
    mockContrato.groupBy.mockResolvedValueOnce([
      { trimestreId: 1, estado: "TESTADO", _count: { _all: 5 } },
      { trimestreId: 1, estado: "BLOQUEADO", _count: { _all: 3 } },
      { trimestreId: 1, estado: "ERROR", _count: { _all: 1 } },
    ]);

    mockTrimestre.findMany.mockResolvedValueOnce([
      { id: 1, anio: 2024, periodo: 1 },
    ]);

    const respuesta = await request(app)
      .get("/api/trimestres")
      .expect(200);

    expect(respuesta.body.success).toBe(true);
    expect(Array.isArray(respuesta.body.trimestres)).toBe(true);
    expect(respuesta.body.trimestres).toHaveLength(1);

    const trim = respuesta.body.trimestres[0] as {
      anio: number;
      periodo: number;
      total: number;
      testados: number;
      bloqueados: number;
      desbloqueados: number;
      errores: number;
    };
    expect(trim.anio).toBe(2024);
    expect(trim.periodo).toBe(1);
    expect(trim.total).toBe(9);
    expect(trim.testados).toBe(5);
    expect(trim.bloqueados).toBe(3);
    expect(trim.desbloqueados).toBe(0);
    expect(trim.errores).toBe(1);
  });

  it("devuelve lista vacía si no hay contratos (groupBy vacío)", async () => {
    const app = crearApp();

    mockContrato.groupBy.mockResolvedValueOnce([]);

    const respuesta = await request(app)
      .get("/api/trimestres")
      .expect(200);

    expect(respuesta.body.success).toBe(true);
    expect(respuesta.body.trimestres).toHaveLength(0);
  });

  it("ordena por anio desc, periodo desc", async () => {
    const app = crearApp();

    // Dos trimestres: 2024 T1 y 2023 T4 — deben salir 2024 T1 primero
    mockContrato.groupBy.mockResolvedValueOnce([
      { trimestreId: 2, estado: "TESTADO", _count: { _all: 2 } },
      { trimestreId: 1, estado: "BLOQUEADO", _count: { _all: 4 } },
    ]);

    mockTrimestre.findMany.mockResolvedValueOnce([
      { id: 1, anio: 2024, periodo: 1 },
      { id: 2, anio: 2023, periodo: 4 },
    ]);

    const respuesta = await request(app)
      .get("/api/trimestres")
      .expect(200);

    const trimestres = respuesta.body.trimestres as Array<{ anio: number; periodo: number }>;
    expect(trimestres).toHaveLength(2);
    expect(trimestres[0].anio).toBe(2024);
    expect(trimestres[0].periodo).toBe(1);
    expect(trimestres[1].anio).toBe(2023);
    expect(trimestres[1].periodo).toBe(4);
  });

  it("maneja múltiples trimestres con todos los estados", async () => {
    const app = crearApp();

    mockContrato.groupBy.mockResolvedValueOnce([
      { trimestreId: 1, estado: "TESTADO", _count: { _all: 10 } },
      { trimestreId: 1, estado: "BLOQUEADO", _count: { _all: 5 } },
      { trimestreId: 1, estado: "DESBLOQUEADO", _count: { _all: 2 } },
      { trimestreId: 1, estado: "ERROR", _count: { _all: 1 } },
    ]);

    mockTrimestre.findMany.mockResolvedValueOnce([
      { id: 1, anio: 2025, periodo: 2 },
    ]);

    const respuesta = await request(app)
      .get("/api/trimestres")
      .expect(200);

    const trim = respuesta.body.trimestres[0] as {
      total: number;
      testados: number;
      bloqueados: number;
      desbloqueados: number;
      errores: number;
    };
    expect(trim.total).toBe(18);
    expect(trim.testados).toBe(10);
    expect(trim.bloqueados).toBe(5);
    expect(trim.desbloqueados).toBe(2);
    expect(trim.errores).toBe(1);
  });
});

describe("GET /api/trimestres/:anio/:periodo/respaldo", () => {
  it("responde 400 si periodo es inválido (p.ej. 9)", async () => {
    const app = crearApp();

    const respuesta = await request(app)
      .get("/api/trimestres/2024/9/respaldo")
      .expect(400);

    expect(respuesta.body.success).toBe(false);
    expect(respuesta.body.message).toMatch(/periodo/i);
  });

  it("responde 400 si periodo es 0", async () => {
    const app = crearApp();

    const respuesta = await request(app)
      .get("/api/trimestres/2024/0/respaldo")
      .expect(400);

    expect(respuesta.body.success).toBe(false);
  });

  it("responde 400 si anio no es numérico", async () => {
    const app = crearApp();

    const respuesta = await request(app)
      .get("/api/trimestres/abc/1/respaldo")
      .expect(400);

    expect(respuesta.body.success).toBe(false);
  });

  it("responde 200 con content-type zip para trimestre válido con contratos bloqueados", async () => {
    const app = crearApp();

    mockContrato.findMany.mockResolvedValueOnce([
      {
        id: 1,
        rutaArchivo: "/data/contratos/contrato1.pdf",
        nombreArchivo: "contrato1.pdf",
        version: 1,
        empleado: { rfc: "ABCD870101XY1", nombre: "JUAN PÉREZ" },
      },
    ]);

    const respuesta = await request(app)
      .get("/api/trimestres/2024/1/respaldo")
      .expect(200);

    expect(respuesta.headers["content-type"]).toMatch(/zip/i);
    // Verifica que se intentó agregar el archivo al ZIP
    expect(fakeArchive.file).toHaveBeenCalledWith(
      "/data/contratos/contrato1.pdf",
      expect.objectContaining({ name: expect.stringContaining("ABCD870101XY1") }),
    );
    // Verifica que se agregó el manifiesto
    expect(fakeArchive.append).toHaveBeenCalledWith(
      expect.stringContaining("ABCD870101XY1"),
      expect.objectContaining({ name: "manifiesto.txt" }),
    );
    // Verifica que se finalizó el archive
    expect(fakeArchive.finalize).toHaveBeenCalled();
    // Verifica que el attachment tiene el nombre correcto
    const contentDisp = respuesta.headers["content-disposition"] as string | undefined;
    expect(contentDisp).toMatch(/respaldo_2024_T1\.zip/);
  });

  it("responde 200 con ZIP vacío (LEEME.txt) si no hay contratos bloqueados", async () => {
    const app = crearApp();

    mockContrato.findMany.mockResolvedValueOnce([]);

    const respuesta = await request(app)
      .get("/api/trimestres/2024/2/respaldo")
      .expect(200);

    expect(respuesta.headers["content-type"]).toMatch(/zip/i);
    // Verifica que se agregó el LEEME.txt en lugar de archivo o manifiesto
    expect(fakeArchive.append).toHaveBeenCalledWith(
      expect.stringContaining("No hay contratos bloqueados o desbloqueados"),
      expect.objectContaining({ name: "LEEME.txt" }),
    );
    expect(fakeArchive.file).not.toHaveBeenCalled();
    expect(fakeArchive.finalize).toHaveBeenCalled();
  });

  it("llama a prisma.contrato.findMany con filtros correctos (BLOQUEADO, no eliminado, trimestre)", async () => {
    const app = crearApp();

    mockContrato.findMany.mockResolvedValueOnce([]);

    await request(app)
      .get("/api/trimestres/2025/3/respaldo")
      .expect(200);

    expect(mockContrato.findMany).toHaveBeenCalledOnce();
    const callArgs = mockContrato.findMany.mock.calls[0][0] as {
      where: {
        eliminado: boolean;
        estado: string;
        trimestre: { anio: number; periodo: number };
      };
    };
    expect(callArgs.where.eliminado).toBe(false);
    expect(callArgs.where.estado).toEqual({ in: ["BLOQUEADO", "DESBLOQUEADO"] });
    expect(callArgs.where.trimestre.anio).toBe(2025);
    expect(callArgs.where.trimestre.periodo).toBe(3);
  });

  it("omite del ZIP archivos que no existen en disco pero los lista en manifiesto como no encontrados", async () => {
    const app = crearApp();

    mockContrato.findMany.mockResolvedValueOnce([
      {
        id: 2,
        rutaArchivo: "/data/contratos/faltante.pdf",
        nombreArchivo: "faltante.pdf",
        version: 1,
        empleado: { rfc: "XYZW900101AB2", nombre: "MARIA LOPEZ" },
      },
    ]);

    // El archivo NO existe en disco
    mockExistsSync.mockReturnValue(false);

    await request(app)
      .get("/api/trimestres/2025/4/respaldo")
      .expect(200);

    // No se debe agregar el archivo al ZIP
    expect(fakeArchive.file).not.toHaveBeenCalled();
    // Pero sí debe haber manifiesto con nota de ARCHIVO_NO_ENCONTRADO
    expect(fakeArchive.append).toHaveBeenCalledWith(
      expect.stringContaining("ARCHIVO_NO_ENCONTRADO"),
      expect.objectContaining({ name: "manifiesto.txt" }),
    );
  });
});
