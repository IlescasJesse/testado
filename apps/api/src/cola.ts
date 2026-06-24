/**
 * Cola de concurrencia limitada.
 * Ejecuta como máximo `limite` tareas simultáneas;
 * las demás esperan en cola y arrancan cuando se libera un slot.
 */
export class Cola {
  private readonly limite: number;
  private activas: number = 0;
  private readonly espera: Array<() => void> = [];

  constructor(limite: number) {
    this.limite = limite;
  }

  add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const ejecutar = () => {
        this.activas++;
        fn()
          .then((valor) => {
            resolve(valor);
          })
          .catch((err: unknown) => {
            reject(err);
          })
          .finally(() => {
            this.activas--;
            const siguiente = this.espera.shift();
            if (siguiente !== undefined) {
              siguiente();
            }
          });
      };

      if (this.activas < this.limite) {
        ejecutar();
      } else {
        this.espera.push(ejecutar);
      }
    });
  }
}
