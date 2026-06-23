/**
 * cifrado.test.ts — Tests TDD para el módulo de cifrado/descifrado con qpdf.
 *
 * Tests de contrato (siempre corren, sin qpdf):
 *   - qpdfDisponible devuelve boolean y no lanza.
 *   - Si qpdf no está disponible, bloquear lanza un Error claro.
 *
 * Tests que requieren qpdf (omitidos si no está instalado):
 *   - bloquear produce un Buffer cifrado distinto del input, con cabecera %PDF.
 *   - desbloquear(bloquear(pdf, pwd), pwd) devuelve bytes con cabecera %PDF.
 *   - desbloquear con contraseña incorrecta lanza Error.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { qpdfDisponible, bloquear, desbloquear } from "./cifrado.js";

// ── PDF mínimo generado en memoria (sin archivos reales de contratos) ──────────

async function crearPdfMinimo(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage();
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// ── Detectar disponibilidad una sola vez ──────────────────────────────────────

const QPDF_OK = qpdfDisponible();

// ── Tests de contrato (siempre corren) ────────────────────────────────────────

describe("qpdfDisponible — contrato de tipos", () => {
  it("devuelve un boolean y no lanza", () => {
    expect(typeof QPDF_OK).toBe("boolean");
  });
});

describe.skipIf(QPDF_OK)(
  "bloquear sin qpdf — lanza Error claro",
  () => {
    it("lanza un Error con mensaje claro cuando qpdf no está instalado", async () => {
      const pdf = await crearPdfMinimo();
      expect(() => bloquear(pdf, "clave123")).toThrow(/qpdf/i);
    });
  },
);

// ── Tests que requieren qpdf ──────────────────────────────────────────────────

describe.skipIf(!QPDF_OK)(
  "bloquear / desbloquear — requiere qpdf",
  () => {
    let pdfMinimo: Buffer;

    beforeAll(async () => {
      pdfMinimo = await crearPdfMinimo();
    });

    it("bloquear produce un Buffer con cabecera %PDF y distinto del input", () => {
      const cifrado = bloquear(pdfMinimo, "claveTest");

      expect(cifrado.length).toBeGreaterThan(0);
      expect(cifrado.slice(0, 4).toString("ascii")).toBe("%PDF");
      // El buffer cifrado debe ser diferente al original
      expect(cifrado.equals(pdfMinimo)).toBe(false);
    });

    it("desbloquear(bloquear(pdf, pwd), pwd) produce un PDF válido", () => {
      const cifrado = bloquear(pdfMinimo, "claveTest2");
      const descifrado = desbloquear(cifrado, "claveTest2");

      expect(descifrado.length).toBeGreaterThan(0);
      expect(descifrado.slice(0, 4).toString("ascii")).toBe("%PDF");
    });

    it("desbloquear con contraseña incorrecta lanza Error del camino esperado", () => {
      const cifrado = bloquear(pdfMinimo, "claveCorrecta");

      // El error debe provenir del fallo de qpdf por contraseña inválida,
      // no de otro camino (p.ej. archivo no encontrado).
      expect(() => desbloquear(cifrado, "claveIncorrecta")).toThrow(
        /password|contraseña|decrypt|invalid|desbloquear/i,
      );
    });
  },
);

// Nota informativa al correr la suite
if (!QPDF_OK) {
  console.log(
    "[cifrado.test] Tests de bloquear/desbloquear omitidos: qpdf no disponible en PATH",
  );
}
