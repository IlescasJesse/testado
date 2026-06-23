/**
 * Calcula el trimestre correspondiente a una fecha dada.
 *
 * @param d - Fecha a evaluar. Usar `new Date(anio, mes, dia)` (constructor local)
 *            en lugar de cadenas ISO para evitar desfase horario en zonas UTC-.
 * @returns Objeto con el año y el periodo trimestral (1–4).
 */
export function trimestreDeFecha(d: Date): { anio: number; periodo: 1 | 2 | 3 | 4 } {
  const periodo = (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  return { anio: d.getFullYear(), periodo };
}
