/**
 * ocr.test.ts — Tests de contrato/tipo para el módulo OCR.
 *
 * Estos tests verifican la firma y el comportamiento de degradación graceful
 * de `detectarDatos` sin requerir los binarios nativos de poppler/tesseract.
 *
 * La verificación funcional completa con PDFs reales está prevista para la
 * Fase 5 (pruebas de integración con binarios instalados).
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { detectarDatos } from "./ocr.js";
import type { ResultadoOCR } from "./ocr.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Devuelve true si los binarios nativos (tesseract + poppler) están disponibles. */
function binarioNativosDisponibles(): boolean {
  try {
    const { execSync } = require("child_process");
    execSync("tesseract --version", { stdio: "ignore" });
    // pdf-poppler depende de pdftoppm (parte de poppler-utils)
    execSync("pdftoppm -v", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const BINARIOS_OK = binarioNativosDisponibles();

// ── Tests de contrato (siempre corren, sin binarios) ─────────────────────────

describe("detectarDatos — contrato de tipos", () => {
  it("es una función", () => {
    expect(typeof detectarDatos).toBe("function");
  });

  it("devuelve una Promise al ser llamada con un Buffer vacío", () => {
    const result = detectarDatos(Buffer.alloc(0));
    // Debe ser thenable antes de resolver
    expect(result).toBeInstanceOf(Promise);
    // No lanzar de forma síncrona — consumir la promesa para evitar unhandled
    return result.catch(() => {
      /* errores de binario son esperados aquí */
    });
  });

  it("resuelve con la forma { rfc, nombre, fecha } al degradar", async () => {
    // Con un buffer inválido los binarios fallarán → debe devolver nulls (no throw)
    const resultado = await detectarDatos(Buffer.from("not a pdf"));

    // Verificar que la forma del objeto es correcta
    expect(resultado).toHaveProperty("rfc");
    expect(resultado).toHaveProperty("nombre");
    expect(resultado).toHaveProperty("fecha");

    // Con input inválido siempre degrada a nulls
    const r = resultado as ResultadoOCR;
    expect(r.rfc === null || typeof r.rfc === "string").toBe(true);
    expect(r.nombre === null || typeof r.nombre === "string").toBe(true);
    expect(r.fecha === null || r.fecha instanceof Date).toBe(true);
  });

  it("acepta el parámetro opts opcional sin lanzar", async () => {
    const resultado = await detectarDatos(Buffer.from("not a pdf"), {
      scale: 1024,
      pageIndex: 0,
    });
    // Solo verifica que no lanzó — el shape se verifica en el test anterior
    expect(resultado).toBeDefined();
  });
});

// ── Tests con binarios (se omiten si no están disponibles) ───────────────────

describe.skipIf(!BINARIOS_OK)(
  "detectarDatos — con binarios nativos disponibles",
  () => {
    it("devuelve nulls para un PDF mínimo válido (sin texto OCR)", async () => {
      // PDF mínimo de 1 página en blanco — compatible con pdf-poppler
      const PDF_MINIMO = Buffer.from(
        "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
          "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
          "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" +
          "xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n" +
          "0000000058 00000 n\n0000000115 00000 n\n" +
          "trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF",
      );

      const resultado = await detectarDatos(PDF_MINIMO);

      expect(resultado).toHaveProperty("rfc");
      expect(resultado).toHaveProperty("nombre");
      expect(resultado).toHaveProperty("fecha");

      // Un PDF en blanco no tiene texto → todos null
      expect(resultado.rfc).toBeNull();
      expect(resultado.nombre).toBeNull();
      expect(resultado.fecha).toBeNull();
    });
  },
);
