// Utilidades core de PDF — exportaciones públicas del paquete @testado/pdf-core

export { calcularHash } from "./hash.js";
export { trimestreDeFecha } from "./trimestre.js";

export { detectarDatos } from "./ocr.js";
export type { ResultadoOCR, OpcionesOCR } from "./ocr.js";

export { testarPdf } from "./censura.js";
export type { ResultadoCensura } from "./censura.js";

// Las siguientes utilidades se exportarán aquí cuando estén implementadas:
// export { cifrarBuffer } from "./cifrado.js";   // Task 5 — cifrado
