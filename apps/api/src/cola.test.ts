import { describe, it, expect } from "vitest";
import { Cola } from "./cola.js";

describe("Cola", () => {
  it("no ejecuta más tareas simultáneas que el límite", async () => {
    const cola = new Cola(2);
    let activas = 0;
    let maxActivas = 0;

    const tarea = () =>
      new Promise<void>((resolve) => {
        activas++;
        if (activas > maxActivas) maxActivas = activas;
        // pequeño await para dar tiempo a que otras tareas se encolen
        setTimeout(() => {
          activas--;
          resolve();
        }, 20);
      });

    await Promise.all([
      cola.add(tarea),
      cola.add(tarea),
      cola.add(tarea),
      cola.add(tarea),
      cola.add(tarea),
    ]);

    expect(maxActivas).toBeLessThanOrEqual(2);
  });

  it("propaga el valor resuelto de fn", async () => {
    const cola = new Cola(1);
    const resultado = await cola.add(() => Promise.resolve(42));
    expect(resultado).toBe(42);
  });

  it("propaga el rechazo de fn sin bloquear la cola", async () => {
    const cola = new Cola(2);
    const resultados: Array<"ok" | "error"> = [];

    const tareaFallida = () => Promise.reject(new Error("fallo esperado"));
    const tareaExitosa = () =>
      Promise.resolve("ok" as const).then((v) => {
        resultados.push("ok");
        return v;
      });

    await Promise.allSettled([
      cola.add(tareaFallida).catch(() => {
        resultados.push("error");
      }),
      cola.add(tareaExitosa),
      cola.add(tareaExitosa),
    ]);

    expect(resultados).toContain("ok");
    expect(resultados).toContain("error");
    // Las 2 tareas exitosas y 1 error deben haber resuelto
    expect(resultados.length).toBe(3);
  });
});
