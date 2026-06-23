// Utilidades core de PDF — exportaciones públicas del paquete @testado/pdf-core

export { calcularHash } from "./hash.js";
export { trimestreDeFecha } from "./trimestre.js";

export { detectarDatos } from "./ocr.js";
export type { ResultadoOCR, OpcionesOCR } from "./ocr.js";

export { testarPdf } from "./censura.js";
export type { ResultadoCensura } from "./censura.js";

export { qpdfDisponible, bloquear, desbloquear } from "./cifrado.js";
