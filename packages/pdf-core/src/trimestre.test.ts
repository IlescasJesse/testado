import { describe, it, expect } from "vitest";
import { trimestreDeFecha } from "./trimestre.js";

// Nota sobre zona horaria: se usan `new Date(anio, mes, dia)` (constructor local)
// con hora implícita 00:00 para evitar que la conversión UTC desplace la fecha
// al día anterior en zonas UTC- (p. ej. UTC-6 en Oaxaca). Así los límites
// de mes son exactos independientemente del TZ del servidor.

describe("trimestreDeFecha", () => {
  it("ubica marzo en T1, octubre en T4 y diciembre en T5", () => {
    expect(trimestreDeFecha(new Date(2026, 2, 15))).toEqual({ anio: 2026, periodo: 1 });
    expect(trimestreDeFecha(new Date(2026, 3, 1))).toEqual({ anio: 2026, periodo: 2 });
    expect(trimestreDeFecha(new Date(2026, 9, 15))).toEqual({ anio: 2026, periodo: 4 });
    expect(trimestreDeFecha(new Date(2026, 11, 31))).toEqual({ anio: 2026, periodo: 5 });
  });

  // T1: enero – marzo (meses 0-2)
  it("T1 — enero a marzo", () => {
    expect(trimestreDeFecha(new Date(2026, 0, 1))).toEqual({ anio: 2026, periodo: 1 });
    expect(trimestreDeFecha(new Date(2026, 2, 31))).toEqual({ anio: 2026, periodo: 1 });
  });

  // T2: abril – junio (meses 3-5)
  it("T2 — abril a junio", () => {
    expect(trimestreDeFecha(new Date(2026, 3, 1))).toEqual({ anio: 2026, periodo: 2 });
    expect(trimestreDeFecha(new Date(2026, 5, 30))).toEqual({ anio: 2026, periodo: 2 });
  });

  // T3: julio – septiembre (meses 6-8)
  it("T3 — julio a septiembre", () => {
    expect(trimestreDeFecha(new Date(2026, 6, 1))).toEqual({ anio: 2026, periodo: 3 });
    expect(trimestreDeFecha(new Date(2026, 8, 30))).toEqual({ anio: 2026, periodo: 3 });
  });

  // T4: octubre – noviembre (meses 9-10)
  it("T4 — octubre a noviembre", () => {
    expect(trimestreDeFecha(new Date(2026, 9, 1))).toEqual({ anio: 2026, periodo: 4 });
    expect(trimestreDeFecha(new Date(2026, 10, 30))).toEqual({ anio: 2026, periodo: 4 });
  });

  // T5: diciembre (mes 11)
  it("T5 — diciembre", () => {
    expect(trimestreDeFecha(new Date(2026, 11, 1))).toEqual({ anio: 2026, periodo: 5 });
    expect(trimestreDeFecha(new Date(2026, 11, 31))).toEqual({ anio: 2026, periodo: 5 });
  });

  // Año correcto se preserva
  it("preserva el año en el resultado", () => {
    expect(trimestreDeFecha(new Date(2025, 0, 1)).anio).toBe(2025);
    expect(trimestreDeFecha(new Date(2024, 6, 15)).anio).toBe(2024);
  });
});
