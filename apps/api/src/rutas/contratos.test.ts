/**
 * contratos.test.ts — Tests del router de contratos.
 *
 * ESTRATEGIA DE MOCK:
 *
 * 1. ../servicios/procesarLote.js
 *    procesarArchivo mockeada para no ejecutar OCR/BD real.
 *
 * 2. ../db.js (prisma)
 *    Mockeado para no requerir BD real. Los métodos devuelven datos ficticios.
 *
 * 3. @testado/pdf-core
 *    qpdfDisponible, bloquear y desbloquear mockeadas.
 *
 * 4. node:fs/promises
 *    readFile y writeFile mockeados para evitar I/O real de archivos.
 *
 * 5. ../server.js
 *    colaGlobal.add mockeado para ejecutar fn() directamente en tests.
 *
 * NOTA: Express 5 propaga errores async vía next(err) internamente cuando se
 * usa async/await dentro de handlers declarados con async. En los handlers de
 * este router se usa try/catch explícito, por lo que supertest captura la
 * respuesta correctamente.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks de módulos ──────────────────────────────────────────────────────────
// vi.mock se eleva automáticamente al tope del archivo por Vitest.

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.4 mock")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
  },
  readFile: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.4 mock")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
}));

// Mock node:fs (sync) para createReadStream usado en el endpoint /:id/archivo
vi.mock("node:fs", async () => {
  const { Readable } = await import("node:stream");
  return {
    default: {
      createReadStream: vi.fn(() => {
        const s = new Readable({ read() { this.push("%PDF-1.4 contenido"); this.push(null); } });
        return s;
      }),
    },
    createReadStream: vi.fn(() => {
      const s = new Readable({ read() { this.push("%PDF-1.4 contenido"); this.push(null); } });
      return s;
    }),
  };
});

vi.mock("@testado/pdf-core", () => ({
  qpdfDisponible: vi.fn(() => true),
  bloquear: vi.fn((_input: Buffer, _pwd: string) => Buffer.from("%PDF-1.4 bloqueado")),
  desbloquear: vi.fn((_input: Buffer, _pwd: string) => Buffer.from("%PDF-1.4 libre")),
  calcularHash: vi.fn(() => "aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd"),
  trimestreDeFecha: vi.fn((d: Date) => ({
    anio: d.getFullYear(),
    periodo: Math.floor(d.getMonth() / 3) + 1,
  })),
  testarPdf: vi.fn(async (_buf: Buffer) => ({
    bytes: Buffer.from("%PDF-1.4 mock"),
    rfc: "ABCD870101XY1",
    nombre: "JUAN PÉREZ",
    fecha: new Date(2024, 2, 15),
  })),
}));

vi.mock("../db.js", () => ({
  prisma: {
    contrato: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    empleado: { upsert: vi.fn() },
    trimestre: { upsert: vi.fn() },
  },
}));

vi.mock("../servicios/procesarLote.js", () => ({
  procesarArchivo: vi.fn(async () => ({
    estado: "testado",
    contratoId: 1,
    rfc: "ABCD870101XY1",
    nombre: "JUAN PÉREZ",
    trimestre: { anio: 2024, periodo: 1 },
    version: 1,
  })),
}));

vi.mock("../server.js", () => ({
  colaGlobal: {
    // Ejecuta fn directamente en tests para simplificar la verificación
    add: vi.fn(<T>(fn: () => Promise<T>) => fn()),
  },
  CONCURRENCIA: 1,
}));

// ── Importaciones (después de los mocks) ─────────────────────────────────────
import request from "supertest";
import express from "express";
import { router } from "./contratos.js";
import { prisma } from "../db.js";
import { qpdfDisponible } from "@testado/pdf-core";
import { procesarArchivo } from "../servicios/procesarLote.js";

// ── App de prueba ─────────────────────────────────────────────────────────────

function crearApp(): ReturnType<typeof express> {
  const app = express();
  app.use(express.json());
  app.use("/api/contratos", router);
  return app;
}

// ── Aliases tipados para mocks ────────────────────────────────────────────────

const mockContrato = prisma.contrato as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

const mockProcesarArchivo = procesarArchivo as ReturnType<typeof vi.fn>;
const mockQpdfDisponible = qpdfDisponible as ReturnType<typeof vi.fn>;

// ── Variables de entorno ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  process.env["QPDF_OWNER_PASSWORD"] = "secreto123";
});

afterEach(() => {
  delete process.env["QPDF_OWNER_PASSWORD"];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/contratos/testar", () => {
  it("responde 200 con loteId y processing:true al enviar un PDF", async () => {
    const app = crearApp();

    const respuesta = await request(app)
      .post("/api/contratos/testar")
      .attach("pdfs", Buffer.from("%PDF-1.4 prueba"), "contrato.pdf")
      .expect(200);

    expect(respuesta.body.success).toBe(true);
    expect(typeof respuesta.body.loteId).toBe("string");
    expect(respuesta.body.loteId.length).toBeGreaterThan(0);
    expect(respuesta.body.total).toBe(1);
    expect(respuesta.body.processing).toBe(true);
  });

  it("responde 400 si no se envían archivos", async () => {
    const app = crearApp();

    const respuesta = await request(app)
      .post("/api/contratos/testar")
      .expect(400);

    expect(respuesta.body.success).toBe(false);
    expect(respuesta.body.message).toMatch(/archivos/i);
  });

  it("llama a procesarArchivo vía colaGlobal por cada archivo", async () => {
    const app = crearApp();

    await request(app)
      .post("/api/contratos/testar")
      .attach("pdfs", Buffer.from("%PDF-1.4 a"), "a.pdf")
      .attach("pdfs", Buffer.from("%PDF-1.4 b"), "b.pdf")
      .expect(200);

    // Esperar el procesamiento en segundo plano (setImmediate)
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockProcesarArchivo).toHaveBeenCalledTimes(2);
  });

  it("responde 400 si periodo está fuera de rango (1-5)", async () => {
    const app = crearApp();

    const respuesta = await request(app)
      .post("/api/contratos/testar")
      .field("anio", "2024")
      .field("periodo", "6")
      .attach("pdfs", Buffer.from("%PDF-1.4 test"), "test.pdf")
      .expect(400);

    expect(respuesta.body.success).toBe(false);
  });
});

describe("GET /api/contratos/progreso", () => {
  it("devuelve total:0 y completado:true si no existe loteId", async () => {
    const app = crearApp();

    const respuesta = await request(app)
      .get("/api/contratos/progreso?loteId=inexistente-9999")
      .expect(200);

    expect(respuesta.body.total).toBe(0);
    expect(respuesta.body.hechos).toEqual([]);
    expect(respuesta.body.completado).toBe(true);
  });

  it("refleja avance del lote al consultarlo con el loteId correcto", async () => {
    const app = crearApp();

    // Primero crear el lote
    const postResp = await request(app)
      .post("/api/contratos/testar")
      .attach("pdfs", Buffer.from("%PDF-1.4 ok"), "ok.pdf")
      .expect(200);

    const { loteId } = postResp.body as { loteId: string };

    // Esperar procesamiento (colaGlobal.add ejecuta de inmediato en test)
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const progResp = await request(app)
      .get(`/api/contratos/progreso?loteId=${loteId}`)
      .expect(200);

    expect(progResp.body.total).toBe(1);
    expect(Array.isArray(progResp.body.hechos)).toBe(true);
    expect(typeof progResp.body.completado).toBe("boolean");
  });
});

describe("GET /api/contratos", () => {
  it("devuelve lista de contratos no eliminados", async () => {
    const app = crearApp();

    const contratosMock = [
      {
        id: 1,
        estado: "TESTADO",
        version: 1,
        nombreArchivo: "contrato.pdf",
        procesadoEn: new Date("2024-01-15T10:00:00Z"),
        errorMsg: null,
        empleado: { rfc: "ABCD870101XY1", nombre: "JUAN PÉREZ" },
        trimestre: { anio: 2024, periodo: 1 },
      },
    ];

    mockContrato.findMany.mockResolvedValueOnce(contratosMock);

    const respuesta = await request(app)
      .get("/api/contratos")
      .expect(200);

    expect(respuesta.body.success).toBe(true);
    expect(Array.isArray(respuesta.body.contratos)).toBe(true);
    expect(respuesta.body.contratos).toHaveLength(1);
    expect(mockContrato.findMany).toHaveBeenCalledOnce();

    // Verifica que se filtre por eliminado: false
    const callArgs = mockContrato.findMany.mock.calls[0][0] as { where: { eliminado: boolean } };
    expect(callArgs.where.eliminado).toBe(false);
  });

  it("aplica filtros de estado y rfc cuando se pasan por query", async () => {
    const app = crearApp();
    mockContrato.findMany.mockResolvedValueOnce([]);

    await request(app)
      .get("/api/contratos?estado=BLOQUEADO&rfc=ABCD")
      .expect(200);

    const callArgs = mockContrato.findMany.mock.calls[0][0] as {
      where: { estado?: string; empleado?: { rfc?: unknown } };
    };
    expect(callArgs.where.estado).toBe("BLOQUEADO");
    expect(callArgs.where.empleado).toBeDefined();
  });
});

describe("POST /api/contratos/bloquear", () => {
  it("responde 409 cuando qpdf no está disponible", async () => {
    const app = crearApp();
    mockQpdfDisponible.mockReturnValueOnce(false);

    const respuesta = await request(app)
      .post("/api/contratos/bloquear")
      .send({ ids: [1] })
      .expect(409);

    expect(respuesta.body.success).toBe(false);
    expect(respuesta.body.message).toMatch(/qpdf/i);
    expect(respuesta.body.message).toMatch(/no está disponible/i);
  });

  it("responde 400 si ids no es un arreglo válido", async () => {
    const app = crearApp();
    mockQpdfDisponible.mockReturnValueOnce(true);

    const respuesta = await request(app)
      .post("/api/contratos/bloquear")
      .send({ ids: [] })
      .expect(400);

    expect(respuesta.body.success).toBe(false);
  });

  it("bloquea contratos y actualiza estado a BLOQUEADO", async () => {
    const app = crearApp();
    mockQpdfDisponible.mockReturnValueOnce(true);

    mockContrato.findUnique.mockResolvedValueOnce({
      id: 1,
      eliminado: false,
      rutaArchivo: "/fake/contrato.pdf",
      estado: "TESTADO",
    });
    mockContrato.update.mockResolvedValueOnce({ id: 1, estado: "BLOQUEADO" });

    const respuesta = await request(app)
      .post("/api/contratos/bloquear")
      .send({ ids: [1] })
      .expect(200);

    expect(respuesta.body.success).toBe(true);
    expect(respuesta.body.bloqueados).toBe(1);
    expect(respuesta.body.errores).toHaveLength(0);

    // Verifica que se actualizó el estado
    expect(mockContrato.update).toHaveBeenCalledOnce();
    const updateArgs = mockContrato.update.mock.calls[0][0] as {
      data: { estado: string };
    };
    expect(updateArgs.data.estado).toBe("BLOQUEADO");
  });
});

describe("POST /api/contratos/desbloquear", () => {
  it("responde 401 con password incorrecta", async () => {
    const app = crearApp();

    const respuesta = await request(app)
      .post("/api/contratos/desbloquear")
      .send({ ids: [1], password: "wrongpassword" })
      .expect(401);

    expect(respuesta.body.success).toBe(false);
    expect(respuesta.body.message).toMatch(/contraseña/i);
  });

  it("responde 400 si no se proporciona password", async () => {
    const app = crearApp();

    const respuesta = await request(app)
      .post("/api/contratos/desbloquear")
      .send({ ids: [1] })
      .expect(400);

    expect(respuesta.body.success).toBe(false);
    expect(respuesta.body.message).toMatch(/password/i);
  });

  it("desbloquea contratos con la contraseña correcta", async () => {
    const app = crearApp();

    mockContrato.findUnique.mockResolvedValueOnce({
      id: 2,
      eliminado: false,
      rutaArchivo: "/fake/bloqueado.pdf",
      estado: "BLOQUEADO",
    });
    mockContrato.update.mockResolvedValueOnce({ id: 2, estado: "DESBLOQUEADO" });

    const respuesta = await request(app)
      .post("/api/contratos/desbloquear")
      .send({ ids: [2], password: "secreto123" })
      .expect(200);

    expect(respuesta.body.success).toBe(true);
    expect(respuesta.body.desbloqueados).toBe(1);

    const updateArgs = mockContrato.update.mock.calls[0][0] as {
      data: { estado: string };
    };
    expect(updateArgs.data.estado).toBe("DESBLOQUEADO");
  });
});

describe("GET /api/contratos/:id/archivo", () => {
  it("responde 200 con Content-Type application/pdf en modo inline por defecto", async () => {
    const app = crearApp();

    mockContrato.findUnique.mockResolvedValueOnce({
      id: 10,
      eliminado: false,
      rutaArchivo: "/fake/contrato.pdf",
      empleado: { rfc: "AEMJ890328B87" },
      trimestre: { anio: 2026, periodo: 2 },
    });

    const respuesta = await request(app)
      .get("/api/contratos/10/archivo")
      .expect(200);

    expect(respuesta.headers["content-type"]).toMatch(/application\/pdf/);
    expect(respuesta.headers["content-disposition"]).toMatch(/inline/);
  });

  it("usa Content-Disposition attachment con ?descargar=1", async () => {
    const app = crearApp();

    mockContrato.findUnique.mockResolvedValueOnce({
      id: 11,
      eliminado: false,
      rutaArchivo: "/fake/contrato.pdf",
      empleado: { rfc: "AEMJ890328B87" },
      trimestre: { anio: 2026, periodo: 2 },
    });

    const respuesta = await request(app)
      .get("/api/contratos/11/archivo?descargar=1")
      .expect(200);

    expect(respuesta.headers["content-disposition"]).toMatch(/attachment/);
    expect(respuesta.headers["content-disposition"]).toMatch(/AEMJ890328B87_2026T2\.pdf/);
  });

  it("responde 404 si el contrato no existe", async () => {
    const app = crearApp();
    mockContrato.findUnique.mockResolvedValueOnce(null);

    const respuesta = await request(app)
      .get("/api/contratos/999/archivo")
      .expect(404);

    expect(respuesta.body.success).toBe(false);
  });

  it("responde 404 si el contrato está eliminado", async () => {
    const app = crearApp();
    mockContrato.findUnique.mockResolvedValueOnce({
      id: 12,
      eliminado: true,
      rutaArchivo: "/fake/contrato.pdf",
      empleado: { rfc: "AEMJ890328B87" },
      trimestre: { anio: 2026, periodo: 2 },
    });

    const respuesta = await request(app)
      .get("/api/contratos/12/archivo")
      .expect(404);

    expect(respuesta.body.success).toBe(false);
  });

  it("responde 400 si el id no es un entero válido", async () => {
    const app = crearApp();

    const respuesta = await request(app)
      .get("/api/contratos/abc/archivo")
      .expect(400);

    expect(respuesta.body.success).toBe(false);
  });
});

describe("POST /api/contratos/:id/eliminar", () => {
  it("marca el contrato como eliminado (soft delete)", async () => {
    const app = crearApp();

    mockContrato.findUnique.mockResolvedValueOnce({ id: 5, eliminado: false });
    mockContrato.update.mockResolvedValueOnce({ id: 5, eliminado: true });

    const respuesta = await request(app)
      .post("/api/contratos/5/eliminar")
      .expect(200);

    expect(respuesta.body.success).toBe(true);

    // Verifica que se llama a update con eliminado: true
    expect(mockContrato.update).toHaveBeenCalledOnce();
    const updateArgs = mockContrato.update.mock.calls[0][0] as {
      where: { id: number };
      data: { eliminado: boolean };
    };
    expect(updateArgs.where.id).toBe(5);
    expect(updateArgs.data.eliminado).toBe(true);
  });

  it("responde 404 si el contrato no existe", async () => {
    const app = crearApp();
    mockContrato.findUnique.mockResolvedValueOnce(null);

    const respuesta = await request(app)
      .post("/api/contratos/999/eliminar")
      .expect(404);

    expect(respuesta.body.success).toBe(false);
  });

  it("responde 404 si el contrato ya está eliminado", async () => {
    const app = crearApp();
    mockContrato.findUnique.mockResolvedValueOnce({ id: 3, eliminado: true });

    const respuesta = await request(app)
      .post("/api/contratos/3/eliminar")
      .expect(404);

    expect(respuesta.body.success).toBe(false);
  });

  it("responde 400 si el id no es un entero válido", async () => {
    const app = crearApp();

    const respuesta = await request(app)
      .post("/api/contratos/abc/eliminar")
      .expect(400);

    expect(respuesta.body.success).toBe(false);
  });
});
