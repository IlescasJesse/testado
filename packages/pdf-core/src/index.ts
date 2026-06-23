// Utilidades core de PDF — exportaciones públicas del paquete @testado/pdf-core

export { calcularHash } from "./hash.js";
export { trimestreDeFecha } from "./trimestre.js";

export { detectarDatos } from "./ocr.js";
export type { ResultadoOCR, OpcionesOCR } from "./ocr.js";

// Las siguientes utilidades se exportarán aquí cuando estén implementadas:
// export { censurarTexto } from "./censura.js";  // Task 4 — censura
// export { cifrarBuffer } from "./cifrado.js";   // Task 5 — cifrado
