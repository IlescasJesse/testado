// packages/pdf-core/types/pdf-poppler.d.ts
// Declaración de tipos para pdf-poppler@0.2.3 (sin @types oficial).
// Forma verificada contra node_modules/pdf-poppler/index.js,
// lib/convert.js, lib/info.js, lib/imgdata.js.

declare module "pdf-poppler" {
  /** Opciones para la función convert (pdf → imagen). */
  export interface ConvertOptions {
    /** Formato de salida: "png" | "jpeg" | "tiff" | "pdf" | "ps" | "eps" | "svg" */
    format?: string;
    /** Resolución de escala (píxeles en el lado más largo). Default: 1024. */
    scale?: number;
    /** Directorio de salida. */
    out_dir?: string | null;
    /** Prefijo del nombre de archivo de salida. */
    out_prefix?: string | null;
    /** Número de página 1-based (null = todas las páginas). */
    page?: number | null;
  }

  /** Metadatos devueltos por info(). Las claves son campos de pdfinfo en snake_case. */
  export type PdfInfo = Record<string, string>;

  /** Registro de una imagen devuelto por imgdata(). */
  export type ImageData = Record<string, string>;

  /**
   * Convierte una o varias páginas de un PDF en imágenes usando pdftocairo.
   * @param file Ruta absoluta al archivo PDF.
   * @param opts Opciones de conversión.
   * @returns Promise que resuelve con el stdout de pdftocairo (generalmente "").
   */
  export function convert(file: string, opts: ConvertOptions): Promise<string>;

  /**
   * Devuelve metadatos del PDF usando pdfinfo.
   * @param file Ruta absoluta al archivo PDF.
   */
  export function info(file: string): Promise<PdfInfo>;

  /**
   * Devuelve datos de imágenes embebidas usando pdfimages -list.
   * @param file Ruta absoluta al archivo PDF.
   */
  export function imgdata(file: string): Promise<ImageData[]>;

  /** Ruta al directorio de binarios de poppler. */
  export const path: string;

  /** Opciones por defecto para execFile de child_process. */
  export const exec_options: {
    encoding: string;
    maxBuffer: number;
    shell: boolean;
  };
}
