import { describe, it, expect } from "vitest";
import { trimestreDeFecha } from "./trimestre.js";

// Nota sobre zona horaria: se usan `new Date(anio, mes, dia)` (constructor local)
// con hora implícita 00:00 para evitar que la conversión UTC desplace la fecha
// al día anterior en zonas UTC- (p. ej. UTC-6 en Oaxaca). Así los límites
// de mes son exactos independientemente del TZ del servidor.

describe("trimestreDeFecha", () => {
  // Caso base del enunciado (adaptado al constructor local para evitar desfase UTC).
  // Las cadenas ISO se interpretan como UTC medianoche; en UTC-6 (Oaxaca)
  // "2026-04-01" se convierte en 2026-03-31T18:00 local → T1.
  // Solución: usar new Date(anio, mes0, dia) que ya opera en hora local.
  it("ubica marzo en T1 y abril en T2", () => {
    expect(trimestreDeFecha(new Date(2026, 2, 15))).toEqual({ anio: 2026, periodo: 1 });
    expect(trimestreDeFecha(new Date(2026, 3, 1))).toEqual({ anio: 2026, periodo: 2 });
    expect(trimestreDeFecha(new Date(2026, 11, 31))).toEqual({ anio: 2026, periodo: 4 });
  });

  // T1: enero – marzo (meses 0-2)
  it("T1 — primer día de enero", () => {
    expect(trimestreDeFecha(new Date(2026, 0, 1))).toEqual({ anio: 2026, periodo: 1 });
  });

  it("T1 — último día de marzo", () => {
    expect(trimestreDeFecha(new Date(2026, 2, 31))).toEqual({ anio: 2026, periodo: 1 });
  });

  // T2: abril – junio (meses 3-5)
  it("T2 — primer día de abril", () => {
    expect(trimestreDeFecha(new Date(2026, 3, 1))).toEqual({ anio: 2026, periodo: 2 });
  });

  it("T2 — último día de junio", () => {
    expect(trimestreDeFecha(new Date(2026, 5, 30))).toEqual({ anio: 2026, periodo: 2 });
  });

  // T3: julio – septiembre (meses 6-8)
  it("T3 — primer día de julio", () => {
    expect(trimestreDeFecha(new Date(2026, 6, 1))).toEqual({ anio: 2026, periodo: 3 });
  });

  it("T3 — último día de septiembre", () => {
    expect(trimestreDeFecha(new Date(2026, 8, 30))).toEqual({ anio: 2026, periodo: 3 });
  });

  // T4: octubre – diciembre (meses 9-11)
  it("T4 — primer día de octubre", () => {
    expect(trimestreDeFecha(new Date(2026, 9, 1))).toEqual({ anio: 2026, periodo: 4 });
  });

  it("T4 — último día de diciembre", () => {
    expect(trimestreDeFecha(new Date(2026, 11, 31))).toEqual({ anio: 2026, periodo: 4 });
  });

  // Año correcto se preserva
  it("preserva el año en el resultado", () => {
    expect(trimestreDeFecha(new Date(2025, 0, 1)).anio).toBe(2025);
    expect(trimestreDeFecha(new Date(2024, 6, 15)).anio).toBe(2024);
  });
});
