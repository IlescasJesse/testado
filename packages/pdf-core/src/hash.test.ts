import { describe, it, expect } from "vitest";
import { calcularHash } from "./hash.js";

describe("calcularHash", () => {
  it("devuelve una cadena hexadecimal de 64 caracteres", () => {
    const resultado = calcularHash(Buffer.from("datos de prueba"));
    expect(resultado).toHaveLength(64);
    expect(resultado).toMatch(/^[0-9a-f]{64}$/);
  });

  it("el mismo buffer produce siempre el mismo hash (determinismo)", () => {
    const buf = Buffer.from("contenido estable");
    expect(calcularHash(buf)).toBe(calcularHash(buf));
  });

  it("buffers con mismo contenido producen el mismo hash", () => {
    const a = Buffer.from("igual");
    const b = Buffer.from("igual");
    expect(calcularHash(a)).toBe(calcularHash(b));
  });

  it("buffers con distinto contenido producen hashes distintos", () => {
    const a = Buffer.from("uno");
    const b = Buffer.from("dos");
    expect(calcularHash(a)).not.toBe(calcularHash(b));
  });

  it("buffer vacío produce hash SHA-256 conocido", () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const esperado =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(calcularHash(Buffer.alloc(0))).toBe(esperado);
  });
});
