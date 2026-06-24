import type { ContratoDTO, Estado, ResumenLote } from "@testado/shared";

export type { ContratoDTO, Estado, ResumenLote };

export interface ResultadoProcesar {
  estado: "testado" | "duplicado" | "cache" | "error";
  contratoId?: number;
  rfc?: string;
  nombre?: string;
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

export interface ResumenTrimestre {
  anio: number;
  periodo: number;
  total: number;
  testados: number;
  bloqueados: number;
  desbloqueados: number;
  errores: number;
}

export interface ResumenBloqueo {
  bloqueados: number;
  errores: string[];
}

export interface ResumenDesbloqueo {
  desbloqueados?: number;
  errores?: string[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export function urlRespaldo(anio: number, periodo: number): string {
  return `${API_URL}/api/trimestres/${anio}/${periodo}/respaldo`;
}

export function urlArchivo(id: number, descargar = false): string {
  return `${API_URL}/api/contratos/${id}/archivo${descargar ? "?descargar=1" : ""}`;
}
