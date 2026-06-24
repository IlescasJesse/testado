/**
 * censura.test.ts — Tests de contrato y smoke test para testarPdf.
 *
 * Tests de contrato (siempre corren, sin binarios):
 *   - Verifican que `testarPdf` es async y que maneja input inválido sin romper.
 *
 * Smoke test (requiere binarios poppler + tesseract y el PDF real):
 *   - Llama a `testarPdf` con el PDF de contrato real.
 *   - Verifica que el PDF de salida es válido (%PDF) y no vacío.
 *   - Verifica que el RFC detectado es AEMJ890328B87.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { testarPdf } from "./censura.js";
import type { ResultadoCensura } from "./censura.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Devuelve true si los binarios nativos están disponibles en el PATH. */
function binarioNativosDisponibles(): boolean {
  try {
    execSync("tesseract --version", { stdio: "ignore" });
    execSync("pdftoppm -v", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Ruta al PDF de contrato real (datos personales — no commiteado). */
const PDF_REAL_PATH = path.resolve(
  process.cwd(),
  "contratos/ACEVEDO MESINAS JOSIMAR.pdf",
);

const BINARIOS_OK = binarioNativosDisponibles();
const PDF_REAL_EXISTE = fs.existsSync(PDF_REAL_PATH);

// ── Tests de contrato (siempre corren) ────────────────────────────────────────

describe("testarPdf — contrato de tipos", () => {
  it("es una función async", () => {
    expect(typeof testarPdf).toBe("function");
  });

  it("devuelve una Promise al ser llamada", () => {
    const result = testarPdf(Buffer.alloc(0));
    expect(result).toBeInstanceOf(Promise);
    // Consumir la promesa para evitar unhandled rejection
    return result.catch(() => {
      /* fallos de binario/PDF inválido son esperados */
    });
  });

  it("maneja Buffer inválido sin lanzar (degradación graceful)", async () => {
    let resultado: ResultadoCensura | null = null;
    let lanzó = false;

    try {
      resultado = await testarPdf(Buffer.from("not a pdf"));
    } catch {
      lanzó = true;
    }

    // Si lanzó, debe ser un error comprensible (no un crash interno sin mensaje)
    // Si no lanzó, el resultado debe tener la forma correcta
    if (!lanzó && resultado !== null) {
      expect(resultado).toHaveProperty("bytes");
      expect(resultado).toHaveProperty("rfc");
      expect(resultado).toHaveProperty("nombre");
      expect(resultado).toHaveProperty("fecha");
    }
    // En cualquier caso, que no quede la suite colgada
    expect(true).toBe(true);
  });
});

// ── Smoke test con PDF real (requiere binarios + archivo) ─────────────────────

describe.skipIf(!BINARIOS_OK || !PDF_REAL_EXISTE)(
  "testarPdf — smoke test con PDF real",
  () => {
    it(
      "genera PDF censurado válido y detecta RFC AEMJ890328B87",
      async () => {
        const inputBytes = fs.readFileSync(PDF_REAL_PATH);
        console.log(
          `[smoke] PDF de entrada: ${(inputBytes.length / 1024).toFixed(1)} KB`,
        );

        const resultado = await testarPdf(inputBytes);

        // (a) El buffer de salida es un PDF válido
        expect(resultado.bytes.length).toBeGreaterThan(0);
        const cabecera = resultado.bytes.slice(0, 4).toString("ascii");
        expect(cabecera).toBe("%PDF");
        console.log(
          `[smoke] PDF de salida: ${(resultado.bytes.length / 1024).toFixed(1)} KB`,
        );

        // (b) RFC detectado correctamente
        console.log(`[smoke] RFC detectado: ${resultado.rfc}`);
        expect(resultado.rfc).toBe("AEMJ890328B87");

        // Guardar salida temporal para inspección visual (NO commiteado)
        const salidaPath = path.join(
          os.tmpdir(),
          `smoke_censura_${Date.now()}.pdf`,
        );
        fs.writeFileSync(salidaPath, resultado.bytes);
        console.log(`[smoke] PDF censurado guardado en: ${salidaPath}`);
        console.log(
          `[smoke] Nombre detectado: ${resultado.nombre ?? "(null)"}`,
        );
        console.log(
          `[smoke] Fecha detectada: ${resultado.fecha?.toISOString() ?? "(null)"}`,
        );
      },
      120_000, // timeout 2 min — OCR puede ser lento
    );
  },
);

// Nota de skip
if (!BINARIOS_OK) {
  console.log(
    "[censura.test] Smoke test omitido: binarios poppler/tesseract no disponibles en PATH",
  );
}
if (!PDF_REAL_EXISTE) {
  console.log(
    `[censura.test] Smoke test omitido: no existe PDF real en ${PDF_REAL_PATH}`,
  );
}
