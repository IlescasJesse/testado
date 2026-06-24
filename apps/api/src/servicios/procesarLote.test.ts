/**
 * procesarLote.test.ts — Tests del servicio de procesamiento de lote.
 *
 * ESTRATEGIA DE MOCK:
 *
 * 1. @testado/pdf-core
 *    Se mockea completamente. `calcularHash` devuelve hash fijo.
 *    `testarPdf` devuelve bytes ficticios + rfc/nombre/fecha fijos.
 *    `trimestreDeFecha` reproduce la lógica real (función pura).
 *
 * 2. ../db.js (prisma)
 *    Se mockea con vi.mock factory que devuelve vi.fn() en línea.
 *    Los valores de retorno se controlan por test con mockResolvedValueOnce
 *    accediendo al módulo mockeado importado vía import().
 *
 * 3. node:fs/promises
 *    Se mockea completamente. mkdir y writeFile resuelven undefined
 *    sin tocar disco. La factory no usa variables externas (evita
 *    el problema de hoisting de vi.mock).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks de módulos ──────────────────────────────────────────────────────────
// IMPORTANTE: vi.mock se eleva al tope del archivo por Vitest.
// Las factories NO deben referenciar variables del módulo superior.

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@testado/pdf-core", () => ({
  calcularHash: vi.fn((_buf: Buffer) =>
    "aabbccdd1122334455667788990011223344556677889900112233445566778899",
  ),
  trimestreDeFecha: vi.fn((d: Date) => ({
    anio: d.getFullYear(),
    periodo: Math.floor(d.getMonth() / 3) + 1,
  })),
  testarPdf: vi.fn(async (_buf: Buffer) => ({
    bytes: Buffer.from("%PDF-1.4 mock"),
    rfc: "ABCD870101XY1",
    nombre: "JUAN PÉREZ LÓPEZ",
    fecha: new Date(2024, 2, 15), // 15 mar 2024 → T1 2024
  })),
}));

vi.mock("../db.js", () => ({
  prisma: {
    contrato: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    empleado: {
      upsert: vi.fn(),
    },
    trimestre: {
      upsert: vi.fn(),
    },
  },
}));

// ── Importaciones (después de los mocks, aunque Vitest lo eleva) ──────────────
import { procesarArchivo } from "./procesarLote.js";
import { testarPdf } from "@testado/pdf-core";
import { prisma } from "../db.js";

// ── Datos de test reutilizables ───────────────────────────────────────────────

const BUF_PRUEBA = Buffer.from("PDF de prueba");
const NOMBRE_ARCHIVO = "contrato_2024.pdf";

const EMPLEADO_MOCK = { id: 1, rfc: "ABCD870101XY1", nombre: "JUAN PÉREZ LÓPEZ" };
const TRIMESTRE_MOCK = { id: 1, anio: 2024, periodo: 1 };
const CONTRATO_MOCK = {
  id: 42,
  empleadoId: 1,
  trimestreId: 1,
  hash: "aabbccdd1122334455667788990011223344556677889900112233445566778899",
  nombreArchivo: NOMBRE_ARCHIVO,
  rutaArchivo: "/fake/ruta.pdf",
  estado: "TESTADO",
  version: 1,
  rfcDetectado: "ABCD870101XY1",
  fechaContrato: new Date(2024, 2, 15),
  procesadoEn: new Date(),
  bloqueadoEn: null,
  errorMsg: null,
  eliminado: false,
  empleado: EMPLEADO_MOCK,
  trimestre: TRIMESTRE_MOCK,
};

// Aliases tipados para los mocks de Prisma.
// Se castea a unknown primero porque el tipo de Prisma no es compatible con Mock<> de Vitest.
const mockContrato = prisma.contrato as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
};
const mockEmpleado = prisma.empleado as unknown as { upsert: ReturnType<typeof vi.fn> };
const mockTrimestre = prisma.trimestre as unknown as { upsert: ReturnType<typeof vi.fn> };

// ── Reset de mocks antes de cada test ────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("procesarArchivo", () => {
  // ── CACHE ───────────────────────────────────────────────────────────────────
  describe("cache por hash", () => {
    it("devuelve estado 'cache' y NO llama a testarPdf si el hash existe en BD", async () => {
      mockContrato.findFirst.mockResolvedValueOnce(CONTRATO_MOCK);

      const resultado = await procesarArchivo(BUF_PRUEBA, NOMBRE_ARCHIVO);

      expect(resultado.estado).toBe("cache");
      expect(resultado.contratoId).toBe(42);
      expect(resultado.rfc).toBe("ABCD870101XY1");
      expect(resultado.trimestre).toEqual({ anio: 2024, periodo: 1 });
      expect(resultado.version).toBe(1);

      // Lo más importante: NO debe haber llamado a testarPdf
      expect(testarPdf).not.toHaveBeenCalled();

      // No crea ni modifica nada en BD
      expect(mockEmpleado.upsert).not.toHaveBeenCalled();
      expect(mockContrato.create).not.toHaveBeenCalled();
    });
  });

  // ── DUPLICADO ───────────────────────────────────────────────────────────────
  describe("detección de duplicados", () => {
    it("devuelve estado 'duplicado' sin crear contrato cuando no hay resolucion", async () => {
      mockContrato.findFirst.mockResolvedValueOnce(null);
      mockEmpleado.upsert.mockResolvedValueOnce(EMPLEADO_MOCK);
      mockTrimestre.upsert.mockResolvedValueOnce(TRIMESTRE_MOCK);
      mockContrato.findMany.mockResolvedValueOnce([CONTRATO_MOCK]);

      const resultado = await procesarArchivo(BUF_PRUEBA, NOMBRE_ARCHIVO);

      expect(resultado.estado).toBe("duplicado");
      expect(resultado.rfc).toBe("ABCD870101XY1");
      expect(resultado.trimestre).toEqual({ anio: 2024, periodo: 1 });
      expect(resultado.mensaje).toMatch(/duplicado|contrato/i);

      // No debe haber creado un contrato nuevo
      expect(mockContrato.create).not.toHaveBeenCalled();
      expect(mockContrato.updateMany).not.toHaveBeenCalled();
    });

    it("devuelve estado 'duplicado' con mensaje 'omitido' si resolucion='omitir'", async () => {
      mockContrato.findFirst.mockResolvedValueOnce(null);
      mockEmpleado.upsert.mockResolvedValueOnce(EMPLEADO_MOCK);
      mockTrimestre.upsert.mockResolvedValueOnce(TRIMESTRE_MOCK);
      mockContrato.findMany.mockResolvedValueOnce([CONTRATO_MOCK]);

      const resultado = await procesarArchivo(BUF_PRUEBA, NOMBRE_ARCHIVO, {
        resolucionDuplicado: "omitir",
      });

      expect(resultado.estado).toBe("duplicado");
      expect(resultado.mensaje).toMatch(/omitido/i);
      expect(mockContrato.create).not.toHaveBeenCalled();
    });
  });

  // ── TESTADO: caso limpio ────────────────────────────────────────────────────
  describe("caso limpio (sin cache, sin duplicado)", () => {
    it("llama a testarPdf, crea contrato versión 1 y devuelve estado 'testado'", async () => {
      mockContrato.findFirst.mockResolvedValueOnce(null);
      mockEmpleado.upsert.mockResolvedValueOnce(EMPLEADO_MOCK);
      mockTrimestre.upsert.mockResolvedValueOnce(TRIMESTRE_MOCK);
      mockContrato.findMany.mockResolvedValueOnce([]);
      mockContrato.create.mockResolvedValueOnce({ ...CONTRATO_MOCK, id: 99 });

      const resultado = await procesarArchivo(BUF_PRUEBA, NOMBRE_ARCHIVO);

      // Debe haber llamado a testarPdf una vez con el buffer correcto
      expect(testarPdf).toHaveBeenCalledOnce();
      expect(testarPdf).toHaveBeenCalledWith(BUF_PRUEBA);

      // Debe haber creado el contrato con version=1 y estado TESTADO
      expect(mockContrato.create).toHaveBeenCalledOnce();
      const callArgs = mockContrato.create.mock.calls[0][0] as {
        data: { version: number; estado: string };
      };
      expect(callArgs.data.version).toBe(1);
      expect(callArgs.data.estado).toBe("TESTADO");

      // Resultado correcto
      expect(resultado.estado).toBe("testado");
      expect(resultado.contratoId).toBe(99);
      expect(resultado.rfc).toBe("ABCD870101XY1");
      expect(resultado.nombre).toBe("JUAN PÉREZ LÓPEZ");
      expect(resultado.trimestre).toEqual({ anio: 2024, periodo: 1 });
      expect(resultado.version).toBe(1);
    });

    it("deriva trimestre desde fecha detectada si opts.trimestre no se proporciona", async () => {
      // Fecha en mayo 2024 → T2
      vi.mocked(testarPdf).mockResolvedValueOnce({
        bytes: Buffer.from("PDF"),
        rfc: "XYZW900212AB3",
        nombre: "ANA GARCÍA",
        fecha: new Date(2024, 4, 10), // mayo → mes 4 (0-indexed) → T2
      });

      mockContrato.findFirst.mockResolvedValueOnce(null);
      mockEmpleado.upsert.mockResolvedValueOnce({ id: 2, rfc: "XYZW900212AB3", nombre: "ANA GARCÍA" });
      mockTrimestre.upsert.mockResolvedValueOnce({ id: 2, anio: 2024, periodo: 2 });
      mockContrato.findMany.mockResolvedValueOnce([]);
      mockContrato.create.mockResolvedValueOnce({ ...CONTRATO_MOCK, id: 55 });

      const resultado = await procesarArchivo(BUF_PRUEBA, NOMBRE_ARCHIVO);

      expect(resultado.trimestre?.periodo).toBe(2);
      expect(resultado.trimestre?.anio).toBe(2024);
    });

    it("devuelve error si no hay fecha y no se pasa opts.trimestre", async () => {
      vi.mocked(testarPdf).mockResolvedValueOnce({
        bytes: Buffer.from("PDF"),
        rfc: "ABCD870101XY1",
        nombre: "JUAN",
        fecha: null,
      });

      mockContrato.findFirst.mockResolvedValueOnce(null);

      const resultado = await procesarArchivo(BUF_PRUEBA, NOMBRE_ARCHIVO);

      expect(resultado.estado).toBe("error");
      expect(resultado.mensaje).toMatch(/trimestre/i);
    });

    it("usa opts.trimestre cuando se proporciona explícitamente", async () => {
      vi.mocked(testarPdf).mockResolvedValueOnce({
        bytes: Buffer.from("PDF"),
        rfc: "ABCD870101XY1",
        nombre: "JUAN",
        fecha: null, // sin fecha en el PDF
      });

      mockContrato.findFirst.mockResolvedValueOnce(null);
      mockEmpleado.upsert.mockResolvedValueOnce(EMPLEADO_MOCK);
      mockTrimestre.upsert.mockResolvedValueOnce({ id: 3, anio: 2023, periodo: 4 });
      mockContrato.findMany.mockResolvedValueOnce([]);
      mockContrato.create.mockResolvedValueOnce({ ...CONTRATO_MOCK, id: 77 });

      const resultado = await procesarArchivo(BUF_PRUEBA, NOMBRE_ARCHIVO, {
        trimestre: { anio: 2023, periodo: 4 },
      });

      expect(resultado.estado).toBe("testado");
      expect(resultado.trimestre).toEqual({ anio: 2023, periodo: 4 });
    });
  });

  // ── RESOLUCIÓN "version" ───────────────────────────────────────────────────
  describe("resolución 'version'", () => {
    it("crea versión 2 cuando ya existe versión 1 y no hace soft-delete", async () => {
      mockContrato.findFirst.mockResolvedValueOnce(null);
      mockEmpleado.upsert.mockResolvedValueOnce(EMPLEADO_MOCK);
      mockTrimestre.upsert.mockResolvedValueOnce(TRIMESTRE_MOCK);
      mockContrato.findMany.mockResolvedValueOnce([CONTRATO_MOCK]); // hay v1
      mockContrato.create.mockResolvedValueOnce({ ...CONTRATO_MOCK, id: 100, version: 2 });

      const resultado = await procesarArchivo(BUF_PRUEBA, NOMBRE_ARCHIVO, {
        resolucionDuplicado: "version",
      });

      expect(resultado.estado).toBe("testado");
      expect(resultado.version).toBe(2);

      // NO debe haber hecho soft-delete
      expect(mockContrato.updateMany).not.toHaveBeenCalled();

      // Debe haber creado con version=2
      const callArgs = mockContrato.create.mock.calls[0][0] as {
        data: { version: number };
      };
      expect(callArgs.data.version).toBe(2);
    });
  });

  // ── RESOLUCIÓN "reemplazar" ────────────────────────────────────────────────
  describe("resolución 'reemplazar'", () => {
    it("hace soft-delete de versiones previas y crea nueva versión", async () => {
      mockContrato.findFirst.mockResolvedValueOnce(null);
      mockEmpleado.upsert.mockResolvedValueOnce(EMPLEADO_MOCK);
      mockTrimestre.upsert.mockResolvedValueOnce(TRIMESTRE_MOCK);
      mockContrato.findMany.mockResolvedValueOnce([CONTRATO_MOCK]);
      mockContrato.updateMany.mockResolvedValueOnce({ count: 1 });
      mockContrato.create.mockResolvedValueOnce({ ...CONTRATO_MOCK, id: 101, version: 2 });

      const resultado = await procesarArchivo(BUF_PRUEBA, NOMBRE_ARCHIVO, {
        resolucionDuplicado: "reemplazar",
      });

      expect(resultado.estado).toBe("testado");
      expect(resultado.version).toBe(2);

      // Debe haber hecho soft-delete
      expect(mockContrato.updateMany).toHaveBeenCalledOnce();
      const updateArgs = mockContrato.updateMany.mock.calls[0][0] as {
        where: { eliminado: boolean };
        data: { eliminado: boolean };
      };
      expect(updateArgs.where.eliminado).toBe(false);
      expect(updateArgs.data.eliminado).toBe(true);
    });
  });

  // ── RFC NULO: pseudo-RFC ─────────────────────────────────────────────────────
  describe("cuando el OCR no detecta RFC", () => {
    it("genera pseudo-RFC SINRFC-<hash8> y usa nombre del archivo como fallback", async () => {
      vi.mocked(testarPdf).mockResolvedValueOnce({
        bytes: Buffer.from("PDF"),
        rfc: null,
        nombre: null,
        fecha: new Date(2024, 0, 15), // enero → T1
      });

      mockContrato.findFirst.mockResolvedValueOnce(null);
      mockContrato.findMany.mockResolvedValueOnce([]);
      mockEmpleado.upsert.mockResolvedValueOnce({
        id: 3,
        rfc: "SINRFC-AABBCCDD",
        nombre: "contrato_2024",
      });
      mockTrimestre.upsert.mockResolvedValueOnce(TRIMESTRE_MOCK);
      mockContrato.create.mockResolvedValueOnce({ ...CONTRATO_MOCK, id: 200 });

      await procesarArchivo(BUF_PRUEBA, "contrato_2024.pdf");

      // El upsert de empleado debe haberse llamado con un pseudo-RFC
      expect(mockEmpleado.upsert).toHaveBeenCalledOnce();
      const upsertArgs = mockEmpleado.upsert.mock.calls[0][0] as {
        where: { rfc: string };
        create: { rfc: string; nombre: string };
      };
      expect(upsertArgs.where.rfc).toMatch(/^SINRFC-/);
      expect(upsertArgs.create.rfc).toMatch(/^SINRFC-/);
      // Nombre fallback = nombre del archivo sin extensión
      expect(upsertArgs.create.nombre).toBe("contrato_2024");
    });
  });

  // ── MANEJO DE ERROR ─────────────────────────────────────────────────────────
  describe("manejo de errores inesperados", () => {
    it("devuelve estado 'error' con mensaje sin lanzar excepción", async () => {
      mockContrato.findFirst.mockRejectedValueOnce(new Error("DB connection failed"));

      const resultado = await procesarArchivo(BUF_PRUEBA, NOMBRE_ARCHIVO);

      expect(resultado.estado).toBe("error");
      expect(resultado.mensaje).toMatch(/DB connection failed/);
    });
  });
});
