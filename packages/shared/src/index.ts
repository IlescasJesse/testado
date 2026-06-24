export type Estado = "TESTADO" | "BLOQUEADO" | "DESBLOQUEADO" | "ERROR";

export interface Trimestre {
  anio: number;
  periodo: 1 | 2 | 3 | 4;
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
