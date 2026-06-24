import { createHash } from "crypto";

/**
 * Calcula el hash SHA-256 de un buffer de bytes.
 *
 * @param buf - Buffer de datos a hashear.
 * @returns Representación hexadecimal del hash (64 caracteres).
 */
export function calcularHash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
