// Límites de recursos de la API en el servidor compartido (dev-finanzas,
// i5-13400: CPUs 0-11 = 6 núcleos P con hyperthreading, 12-15 = 4 núcleos E).
// El OCR (tesseract/poppler) es lo único pesado de Testado y corre como
// procesos hijos de la API, así que heredan estos límites:
//   - taskset: Testado solo puede usar las CPUs 8-15; las 0-7 (4 núcleos P)
//     quedan siempre libres para las demás apps (SIRH, SIAST, etc.).
//   - nice 10: si aun así compiten por una CPU, ganan las demás apps.
//   - TESTADO_CONCURRENCIA: máximo de PDFs procesándose a la vez.
//   - OMP_THREAD_LIMIT=1: un hilo por tesseract (por defecto usa hasta 4, lo
//     que multiplicaría la carga por PDF y rompería el tope de concurrencia).
const CPUS_API = "8-15";
const limitar = process.platform === "linux";

module.exports = {
  apps: [
    {
      name: "testado-api",
      script: limitar ? "taskset" : "apps/api/dist/server.js",
      args: limitar ? `-c ${CPUS_API} nice -n 10 node apps/api/dist/server.js` : undefined,
      interpreter: limitar ? "none" : undefined,
      cwd: __dirname,
      env: { PORT: "3011", TESTADO_CONCURRENCIA: "4", OMP_THREAD_LIMIT: "1" },
    },
    {
      name: "testado-web",
      script: "npm",
      args: "run start -w @testado/web",
      cwd: __dirname,
    },
  ],
};
