import express from "express";
import cors from "cors";
import os from "os";
import { Cola } from "./cola.js";
import { router as rutasContratos } from "./rutas/contratos.js";
import { router as rutasTrimestres } from "./rutas/trimestres.js";

// ---------------------------------------------------------------------------
// Concurrencia global: usa todos los núcleos menos uno (mínimo 1)
// ---------------------------------------------------------------------------
export const CONCURRENCIA = Math.max(1, os.cpus().length - 1);
export const colaGlobal = new Cola(CONCURRENCIA);

// ---------------------------------------------------------------------------
// Bootstrap de Express
// ---------------------------------------------------------------------------
const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Rutas de contratos
app.use("/api/contratos", rutasContratos);

// Rutas de trimestres
app.use("/api/trimestres", rutasTrimestres);

// ---------------------------------------------------------------------------
// Inicio del servidor
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

app.listen(PORT, "0.0.0.0", () => {
  const interfaces = os.networkInterfaces();
  const direccionesRed: string[] = [];

  for (const nombre of Object.keys(interfaces)) {
    const ifaces = interfaces[nombre];
    if (ifaces === undefined) continue;
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) {
        direccionesRed.push(iface.address);
      }
    }
  }

  console.log("\nServidor iniciado");
  console.log(`   Local:        http://localhost:${PORT}`);
  direccionesRed.forEach((addr) => {
    console.log(`   Red:          http://${addr}:${PORT}`);
  });
  console.log(`   Concurrencia: ${CONCURRENCIA} slots (${os.cpus().length} núcleos - 1)\n`);
});

export default app;
