/**
 * ocr.test.ts — Tests de contrato/tipo para el módulo OCR.
 *
 * Tests puros (sin OCR real):
 *   - extraerFecha: parseo de rango de vigencia y fechas puntuales.
 *   - extraerNombre: extracción de primera línea y marcadores.
 *   - nombreDesdeArchivo: normalización desde nombre de archivo.
 *   - detectarDatos: contrato de tipos y degradación graceful.
 *
 * Tests con binarios (skipIf no disponibles):
 *   - detectarDatos con PDF mínimo.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { detectarDatos, extraerFecha, extraerNombre, nombreDesdeArchivo } from "./ocr.js";
import type { ResultadoOCR } from "./ocr.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Devuelve true si los binarios nativos (tesseract + poppler) están disponibles. */
function binarioNativosDisponibles(): boolean {
  try {
    execSync("tesseract --version", { stdio: "ignore" });
    execSync("pdftoppm -v", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const BINARIOS_OK = binarioNativosDisponibles();

// ── Tests puros: extraerFecha ─────────────────────────────────────────────────

describe("extraerFecha — rango de vigencia", () => {
  it("detecta rango 'DEL 01 DE ABRIL AL 30 DE JUNIO DE 2026' → 2026-04-01", () => {
    const texto =
      "prestación de servicios por tiempo determinado\nDEL 01 DE ABRIL AL 30 DE JUNIO DE 2026.";
    const resultado = extraerFecha(texto);
    expect(resultado).not.toBeNull();
    expect(resultado!.getFullYear()).toBe(2026);
    expect(resultado!.getMonth()).toBe(3); // abril = índice 3
    expect(resultado!.getDate()).toBe(1);
  });

  it("detecta rango T1: 'DEL 01 DE ENERO AL 31 DE MARZO DE 2026' → 2026-01-01", () => {
    const texto = "DEL 01 DE ENERO AL 31 DE MARZO DE 2026";
    const resultado = extraerFecha(texto);
    expect(resultado).not.toBeNull();
    expect(resultado!.getFullYear()).toBe(2026);
    expect(resultado!.getMonth()).toBe(0); // enero = índice 0
    expect(resultado!.getDate()).toBe(1);
  });

  it("detecta rango T3: 'DEL 01 DE JULIO AL 30 DE SEPTIEMBRE DE 2025' → 2025-07-01", () => {
    const texto = "DEL 01 DE JULIO AL 30 DE SEPTIEMBRE DE 2025";
    const resultado = extraerFecha(texto);
    expect(resultado).not.toBeNull();
    expect(resultado!.getFullYear()).toBe(2025);
    expect(resultado!.getMonth()).toBe(6); // julio = índice 6
    expect(resultado!.getDate()).toBe(1);
  });

  it("detecta rango T4: 'DEL 01 DE OCTUBRE AL 31 DE DICIEMBRE DE 2025' → 2025-10-01", () => {
    const texto = "DEL 01 DE OCTUBRE AL 31 DE DICIEMBRE DE 2025";
    const resultado = extraerFecha(texto);
    expect(resultado).not.toBeNull();
    expect(resultado!.getFullYear()).toBe(2025);
    expect(resultado!.getMonth()).toBe(9); // octubre = índice 9
    expect(resultado!.getDate()).toBe(1);
  });

  it("acepta variante sin año en inicio: 'DEL 1 DE ABRIL AL 30 DE JUNIO DE 2026'", () => {
    // El año solo aparece al final del rango (forma más común en contratos reales)
    const texto = "DEL 1 DE ABRIL AL 30 DE JUNIO DE 2026";
    const resultado = extraerFecha(texto);
    expect(resultado).not.toBeNull();
    expect(resultado!.getFullYear()).toBe(2026);
    expect(resultado!.getMonth()).toBe(3);
  });

  it("acepta texto con saltos de línea OCR en el rango", () => {
    const texto = "DEL 01 DE ABRIL\nAL 30 DE JUNIO DE 2026";
    const resultado = extraerFecha(texto);
    expect(resultado).not.toBeNull();
    expect(resultado!.getFullYear()).toBe(2026);
    expect(resultado!.getMonth()).toBe(3);
  });

  it("devuelve null para texto sin fecha", () => {
    const resultado = extraerFecha("Este texto no contiene ninguna fecha.");
    expect(resultado).toBeNull();
  });

  it("devuelve null para string vacío", () => {
    expect(extraerFecha("")).toBeNull();
  });

  it("detecta fecha puntual 'de enero de 2025' como fallback", () => {
    const resultado = extraerFecha("Firmado el 15 de enero de 2025 en Oaxaca.");
    expect(resultado).not.toBeNull();
    expect(resultado!.getFullYear()).toBe(2025);
    expect(resultado!.getMonth()).toBe(0);
    expect(resultado!.getDate()).toBe(15);
  });

  it("detecta fecha ISO '2025-03-01' como fallback", () => {
    const resultado = extraerFecha("Fecha de inicio: 2025-03-01.");
    expect(resultado).not.toBeNull();
    expect(resultado!.getFullYear()).toBe(2025);
    expect(resultado!.getMonth()).toBe(2);
    expect(resultado!.getDate()).toBe(1);
  });
});

// ── Tests puros: extraerNombre ────────────────────────────────────────────────

describe("extraerNombre — extracción por primera línea", () => {
  it("extrae nombre de la primera línea cuando es válido", () => {
    const texto =
      "ACEVEDO MESINAS JOSIMAR\nDADM 0103\nCONTRATO DE PRESTACIÓN DE SERVICIOS";
    const resultado = extraerNombre(texto);
    expect(resultado).toBe("ACEVEDO MESINAS JOSIMAR");
  });

  it("normaliza a mayúsculas", () => {
    const texto = "Acevedo Mesinas Josimar\nOtro contenido";
    const resultado = extraerNombre(texto);
    expect(resultado).toBe("ACEVEDO MESINAS JOSIMAR");
  });

  it("descarta primera línea con dígitos y usa marcador como respaldo", () => {
    const texto =
      "DADM 0103\nNOMBRE DEL PRESTADOR\nGARCÍA LÓPEZ ROBERTO\nMás texto";
    const resultado = extraerNombre(texto);
    expect(resultado).toBe("GARCÍA LÓPEZ ROBERTO");
  });

  it("devuelve null si no hay nombre válido en ninguna estrategia", () => {
    const texto = "12345 67890\nCONTRATO DE SERVICIOS\nFECHA: 01/04/2026";
    const resultado = extraerNombre(texto);
    expect(resultado).toBeNull();
  });

  it("devuelve null para texto vacío", () => {
    expect(extraerNombre("")).toBeNull();
  });
});

// ── Tests puros: nombreDesdeArchivo ──────────────────────────────────────────

describe("nombreDesdeArchivo", () => {
  it("quita extensión .pdf y devuelve en mayúsculas", () => {
    expect(nombreDesdeArchivo("ACEVEDO MESINAS JOSIMAR.pdf")).toBe(
      "ACEVEDO MESINAS JOSIMAR",
    );
  });

  it("normaliza espacios múltiples a uno solo", () => {
    expect(nombreDesdeArchivo("GARCIA  LOPEZ  ROBERTO.pdf")).toBe(
      "GARCIA LOPEZ ROBERTO",
    );
  });

  it("maneja archivos sin extensión", () => {
    expect(nombreDesdeArchivo("GARCIA LOPEZ")).toBe("GARCIA LOPEZ");
  });

  it("maneja ruta completa con subdirectorios", () => {
    expect(nombreDesdeArchivo("/ruta/a/PEREZ HERNANDEZ.pdf")).toBe(
      "PEREZ HERNANDEZ",
    );
  });

  it("convierte a mayúsculas aunque venga en minúsculas", () => {
    expect(nombreDesdeArchivo("garcia lopez.pdf")).toBe("GARCIA LOPEZ");
  });
});

// ── Tests de contrato (siempre corren, sin binarios) ─────────────────────────

describe("detectarDatos — contrato de tipos", () => {
  it("es una función", () => {
    expect(typeof detectarDatos).toBe("function");
  });

  it("devuelve una Promise al ser llamada con un Buffer vacío", () => {
    const result = detectarDatos(Buffer.alloc(0));
    expect(result).toBeInstanceOf(Promise);
    return result.catch(() => {
      /* errores de binario son esperados aquí */
    });
  });

  it("resuelve con la forma { rfc, nombre, fecha } al degradar", async () => {
    const resultado = await detectarDatos(Buffer.from("not a pdf"));
    expect(resultado).toHaveProperty("rfc");
    expect(resultado).toHaveProperty("nombre");
    expect(resultado).toHaveProperty("fecha");

    const r = resultado as ResultadoOCR;
    expect(r.rfc === null || typeof r.rfc === "string").toBe(true);
    expect(r.nombre === null || typeof r.nombre === "string").toBe(true);
    expect(r.fecha === null || r.fecha instanceof Date).toBe(true);
  });

  it("acepta el parámetro opts opcional sin lanzar", async () => {
    const resultado = await detectarDatos(Buffer.from("not a pdf"), {
      scale: 1024,
      pageIndex: 0,
      omitirOCRFecha: true,
    });
    expect(resultado).toBeDefined();
  });
});

// ── Tests con binarios (se omiten si no están disponibles) ───────────────────

describe.skipIf(!BINARIOS_OK)(
  "detectarDatos — con binarios nativos disponibles",
  () => {
    it("devuelve nulls para un PDF mínimo válido (sin texto OCR)", async () => {
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

      expect(resultado.rfc).toBeNull();
      expect(resultado.nombre).toBeNull();
      expect(resultado.fecha).toBeNull();
    });
  },
);
