/**
 * cifrado.ts — Cifrado y descifrado de PDFs con qpdf.
 *
 * Exporta tres funciones:
 *   - qpdfDisponible: detecta si qpdf está instalado en el PATH.
 *   - bloquear: cifra un PDF con contraseña de propietario (user-password vacío).
 *   - desbloquear: quita el cifrado usando la contraseña de propietario.
 *
 * La contraseña NO está hardcodeada aquí. La capa API la lee de la variable de
 * entorno QPDF_OWNER_PASSWORD y la pasa como parámetro `ownerPwd`.
 *
 * Dependencia nativa requerida: qpdf (instalado y accesible en PATH).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// ── Utilidades internas ───────────────────────────────────────────────────────

/**
 * Crea un archivo temporal con el contenido del buffer y devuelve su ruta.
 * El llamador es responsable de eliminarlo en un bloque `finally`.
 */
function escribirTemp(contenido: Buffer, sufijo: string): string {
  const ruta = path.join(os.tmpdir(), `pdf-core-${Date.now()}-${Math.random().toString(36).slice(2)}${sufijo}`);
  fs.writeFileSync(ruta, contenido);
  return ruta;
}

/**
 * Elimina un archivo temporal ignorando errores (archivo ya borrado, etc.).
 */
function eliminarTemp(ruta: string): void {
  try {
    fs.unlinkSync(ruta);
  } catch {
    // Ignorar — el archivo puede no existir si el proceso falló antes de crearlo
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Devuelve `true` si qpdf está disponible en el PATH; `false` en caso contrario.
 * No lanza bajo ninguna circunstancia.
 */
export function qpdfDisponible(): boolean {
  try {
    const resultado = spawnSync("qpdf", ["--version"], { stdio: "pipe" });
    return resultado.status === 0;
  } catch {
    return false;
  }
}

/**
 * Cifra un PDF con qpdf.
 *
 * - user-password: vacío (el PDF se puede ABRIR sin contraseña).
 * - owner-password: `ownerPwd` (requerida para modificar/cambiar permisos).
 * - Bits de cifrado: 256.
 * - Permisos: modify=none, print=full.
 *
 * @param input    Bytes del PDF a cifrar.
 * @param ownerPwd Contraseña de propietario. La capa API la lee de QPDF_OWNER_PASSWORD.
 * @returns        Bytes del PDF cifrado.
 * @throws         Error si qpdf no está disponible o si el proceso falla.
 */
export function bloquear(input: Buffer, ownerPwd: string): Buffer {
  if (!qpdfDisponible()) {
    throw new Error("qpdf no está disponible — instálalo y asegúrate de que esté en el PATH");
  }

  const rutaEntrada = escribirTemp(input, "-in.pdf");
  const rutaSalida = escribirTemp(Buffer.alloc(0), "-out.pdf");

  try {
    const args = [
      "--encrypt",
      "",          // user-password vacío: abrir sin contraseña
      ownerPwd,    // owner-password: requerida para editar/cambiar permisos
      "256",       // bits de cifrado AES-256
      "--modify=none",
      "--print=full",
      "--",
      rutaEntrada,
      rutaSalida,
    ];

    const resultado = spawnSync("qpdf", args, { stdio: "pipe" });

    if (resultado.status !== 0) {
      const stderr = resultado.stderr?.toString("utf8") ?? "";
      throw new Error(`qpdf bloquear falló (código ${resultado.status}): ${stderr}`);
    }

    return fs.readFileSync(rutaSalida);
  } finally {
    eliminarTemp(rutaEntrada);
    eliminarTemp(rutaSalida);
  }
}

/**
 * Descifra un PDF cifrado con qpdf.
 *
 * Usa `qpdf --password=<ownerPwd> --decrypt` para quitar el cifrado.
 *
 * @param input    Bytes del PDF cifrado.
 * @param ownerPwd Contraseña de propietario usada al cifrar.
 * @returns        Bytes del PDF descifrado.
 * @throws         Error si qpdf no está disponible, la contraseña es incorrecta
 *                 o el proceso falla por cualquier razón.
 */
export function desbloquear(input: Buffer, ownerPwd: string): Buffer {
  if (!qpdfDisponible()) {
    throw new Error("qpdf no está disponible — instálalo y asegúrate de que esté en el PATH");
  }

  const rutaEntrada = escribirTemp(input, "-enc.pdf");
  const rutaSalida = escribirTemp(Buffer.alloc(0), "-dec.pdf");

  try {
    const args = [
      `--password=${ownerPwd}`,
      "--decrypt",
      "--",
      rutaEntrada,
      rutaSalida,
    ];

    const resultado = spawnSync("qpdf", args, { stdio: "pipe" });

    if (resultado.status !== 0) {
      const stderr = resultado.stderr?.toString("utf8") ?? "";
      throw new Error(`qpdf desbloquear falló (código ${resultado.status}): ${stderr}`);
    }

    return fs.readFileSync(rutaSalida);
  } finally {
    eliminarTemp(rutaEntrada);
    eliminarTemp(rutaSalida);
  }
}
