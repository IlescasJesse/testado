/**
 * Calcula el periodo correspondiente a una fecha dada.
 * 5 periodos por ejercicio:
 *   1 = Ene–Mar, 2 = Abr–Jun, 3 = Jul–Sep, 4 = Oct–Nov, 5 = Dic
 *
 * @param d - Fecha a evaluar. Usar `new Date(anio, mes, dia)` (constructor local)
 *            en lugar de cadenas ISO para evitar desfase horario en zonas UTC-.
 * @returns Objeto con el año y el periodo (1–5).
 */
export function trimestreDeFecha(d: Date): { anio: number; periodo: 1 | 2 | 3 | 4 | 5 } {
  const m = d.getMonth();
  const periodo = (m <= 2 ? 1 : m <= 5 ? 2 : m <= 8 ? 3 : m <= 10 ? 4 : 5) as 1 | 2 | 3 | 4 | 5;
  return { anio: d.getFullYear(), periodo };
}
