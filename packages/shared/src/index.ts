export type Estado = "TESTADO" | "BLOQUEADO" | "DESBLOQUEADO" | "ERROR";
export type EstadoProceso = "testado" | "duplicado" | "cache" | "error";

export interface Trimestre {
  anio: number;
  periodo: 1 | 2 | 3 | 4 | 5;
}

export interface ContratoDTO {
  id: number;
  rfc: string;
  nombre: string | null;
  estado: Estado;
  anio: number;
  periodo: number;
  version: number;
  nombreArchivo: string;
  procesadoEn: string;
  errorMsg: string | null;
}

export interface ResumenLote {
  total: number;
  testados: number;
  errores: number;
  duplicados: number;
}

// ── Procesamiento de lotes ──────────────────────────────────────────────────────

export interface ResultadoProcesar {
  estado: EstadoProceso;
  contratoId?: number;
  rfc?: string | null;
  nombre?: string | null;
  trimestre?: { anio: number; periodo: number };
  version?: number;
  mensaje?: string;
}

export interface ProgresoLote {
  total: number;
  hechos: ResultadoProcesar[];
  completado: boolean;
}

export interface LoteIniciado {
  success: boolean;
  loteId: string;
  total: number;
  processing: boolean;
}

// ── Trimestres ──────────────────────────────────────────────────────────────────

export interface ResumenTrimestre {
  anio: number;
  periodo: number;
  total: number;
  testados: number;
  bloqueados: number;
  desbloqueados: number;
  errores: number;
}

// ── Bloqueo/Desbloqueo ──────────────────────────────────────────────────────────

export interface ErrorBloqueo {
  id: number;
  mensaje: string;
}

export interface ResumenBloqueo {
  bloqueados: number;
  errores: ErrorBloqueo[];
}

export interface ResumenDesbloqueo {
  desbloqueados?: number;
  errores?: ErrorBloqueo[];
}

// ── Bloqueo/Desbloqueo por lotes (progreso contrato por contrato) ───────────────

export interface ResultadoAccion {
  id: number;
  rfc?: string | null;
  nombre?: string | null;
  ok: boolean;
  mensaje?: string;
}

export interface ProgresoAccion {
  total: number;
  hechos: ResultadoAccion[];
  completado: boolean;
}

export interface LoteAccionIniciado {
  success: boolean;
  loteId: string;
  total: number;
}

export interface ResumenEliminarTrimestre {
  success: boolean;
  eliminados: number;
}
