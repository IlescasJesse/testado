# Rediseño Testado por Trimestre — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescribir la app de censura de contratos como un monorepo Next.js+MUI / Express+Prisma con control por trimestre, flujo testar→bloquear, cache por hash y OCR concurrente, manteniendo el comportamiento de censura ya probado.

**Architecture:** Monorepo npm workspaces. `packages/pdf-core` aísla la lógica pura de PDF (OCR, censura, cifrado, hash) migrada desde `server.js`. `apps/api` (Express+TS) orquesta cola, BD (Prisma/MySQL) y expone REST. `apps/web` (Next.js 14 App Router + MUI v6) consume REST con 3 vistas por proceso. Todo el procesamiento pesado corre en la PC servidor; los clientes solo usan el navegador.

**Tech Stack:** Node 20+, TypeScript 5, Next.js 14 (App Router), MUI v6, Express 4/5, Prisma 5 + MySQL 8, tesseract (node-tesseract-ocr), pdf-poppler, pdf-lib, @pdf-lib/fontkit, canvas, qpdf (binario externo), archiver, vitest.

## Global Constraints

- TypeScript estricto, evitar `any`. (CLAUDE.md)
- async/await con try/catch en toda operación async. (CLAUDE.md)
- Toda configuración sensible vía variables de entorno; contraseña qpdf en `.env`, nunca en repo. (spec §7)
- Soft delete (`eliminado: boolean`), nunca borrado físico. (spec §7, §2)
- Nombres en español para dominio (Empleado, Trimestre, Contrato, Estado), inglés para código/variables. (CLAUDE.md)
- Color primario MUI guinda `#621132` (claro `#8a1846`, oscuro `#3d0a1f`). (spec §2, §8)
- Material Icons (MUI) en todas las vistas, botones, estados y tarjetas. (spec §8)
- Periodo = trimestre 1-4 (T1 Ene-Mar, T2 Abr-Jun, T3 Jul-Sep, T4 Oct-Dic). (spec §2)
- El comportamiento de censura migrado de `server.js` NO debe cambiar; verificar paridad. (spec §10)
- Concurrencia OCR = `núcleos - 1`; rutas de guardado fijas por defecto (sin pantalla de ajustes). (spec §2, §6)
- Almacenamiento físico: `contratos/{anio}/T{periodo}/{RFC}_v{n}.pdf`. (spec §4)
- Unicidad de contrato: `@@unique([empleadoId, trimestreId, version])`. (spec §4)

---

## Mapa de archivos

```
package.json                      (raíz, workspaces)
tsconfig.base.json
.env.example
prisma/schema.prisma
prisma/migrations/...
packages/shared/src/index.ts      (tipos/DTOs)
packages/pdf-core/src/
  hash.ts          calcularHash(buffer) -> sha256
  trimestre.ts     trimestreDeFecha(date) -> {anio,periodo}; rango fechas
  ocr.ts           detectarRFC/nombre/fecha (migrado)
  censura.ts       censorPdf y helpers (migrado, sin cambios de comportamiento)
  cifrado.ts       bloquear/desbloquear con qpdf
  index.ts
apps/api/src/
  server.ts        bootstrap Express
  db.ts            Prisma client singleton
  cola.ts          cola concurrente (límite núcleos-1)
  rutas/contratos.ts
  rutas/trimestres.ts
  servicios/procesarLote.ts
apps/web/
  app/layout.tsx, app/theme.ts
  app/page.tsx (Subir & Testar)
  app/bloquear/page.tsx
  app/trimestres/page.tsx
  lib/api.ts (cliente REST)
  components/...
```

---

## Fase 0 — Andamiaje del monorepo

### Task 1: Inicializar monorepo npm workspaces + TypeScript base

**Files:**
- Create: `package.json` (raíz), `tsconfig.base.json`, `.env.example`, `.gitignore` (actualizar)
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`

**Interfaces:**
- Produces: workspaces `apps/*` y `packages/*`; alias TS `@testado/shared`, `@testado/pdf-core`.

- [ ] **Step 1:** Crear `package.json` raíz con workspaces y scripts.

```json
{
  "name": "testado-monorepo",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "dev:api": "npm run dev -w @testado/api",
    "dev:web": "npm run dev -w @testado/web",
    "test": "vitest run",
    "prisma:migrate": "prisma migrate dev"
  },
  "devDependencies": { "typescript": "^5.4.0", "vitest": "^1.6.0" }
}
```

- [ ] **Step 2:** Crear `tsconfig.base.json` con `strict: true`, `noImplicitAny: true`, paths a packages.
- [ ] **Step 3:** Crear `packages/shared` con tipos compartidos.

```ts
// packages/shared/src/index.ts
export type Estado = "TESTADO" | "BLOQUEADO" | "DESBLOQUEADO" | "ERROR";
export interface Trimestre { anio: number; periodo: 1 | 2 | 3 | 4; }
export interface ContratoDTO {
  id: number; rfc: string; nombre: string | null; estado: Estado;
  anio: number; periodo: number; version: number; nombreArchivo: string;
  procesadoEn: string; errorMsg: string | null;
}
export interface ResumenLote { total: number; testados: number; errores: number; duplicados: number; }
```

- [ ] **Step 4:** Verificar build: `npx tsc -p packages/shared/tsconfig.json --noEmit` → sin errores.
- [ ] **Step 5:** Commit.

```bash
git add -A && git commit -m "chore: andamiaje monorepo workspaces + shared types"
```

---

## Fase 1 — Núcleo de PDF (`packages/pdf-core`)

> Migración de `server.js`. La censura debe conservar comportamiento; OCR/cifrado se modularizan.

### Task 2: Utilidades puras — hash y trimestre (TDD)

**Files:**
- Create: `packages/pdf-core/src/hash.ts`, `packages/pdf-core/src/trimestre.ts`
- Test: `packages/pdf-core/src/hash.test.ts`, `packages/pdf-core/src/trimestre.test.ts`

**Interfaces:**
- Produces: `calcularHash(buf: Buffer): string` (sha256 hex); `trimestreDeFecha(d: Date): { anio: number; periodo: 1|2|3|4 }`.

- [ ] **Step 1:** Test de `trimestreDeFecha`.

```ts
import { describe, it, expect } from "vitest";
import { trimestreDeFecha } from "./trimestre";
describe("trimestreDeFecha", () => {
  it("ubica marzo en T1 y abril en T2", () => {
    expect(trimestreDeFecha(new Date("2026-03-15"))).toEqual({ anio: 2026, periodo: 1 });
    expect(trimestreDeFecha(new Date("2026-04-01"))).toEqual({ anio: 2026, periodo: 2 });
    expect(trimestreDeFecha(new Date("2026-12-31"))).toEqual({ anio: 2026, periodo: 4 });
  });
});
```

- [ ] **Step 2:** Correr → FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar.

```ts
// trimestre.ts
export function trimestreDeFecha(d: Date): { anio: number; periodo: 1 | 2 | 3 | 4 } {
  const periodo = (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  return { anio: d.getFullYear(), periodo };
}
```

- [ ] **Step 4:** Test de `calcularHash` (mismo buffer → mismo hash; distinto → distinto). Implementar con `crypto.createHash("sha256")`.
- [ ] **Step 5:** Correr todo → PASS. Commit `feat(pdf-core): hash y trimestre con tests`.

### Task 3: Migrar OCR a `ocr.ts`

**Files:**
- Create: `packages/pdf-core/src/ocr.ts`
- Reference: `server.js:57-200` (detección RFC/OCR actual)

**Interfaces:**
- Produces: `detectarDatos(pdfBytes: Buffer): Promise<{ rfc: string|null; nombre: string|null; fecha: Date|null }>`.

- [ ] **Step 1:** Mover la lógica de `detectarYTestarRFCEnImagen` y el parseo de RFC a `ocr.ts`, extrayendo además nombre y fecha del texto OCR. Mantener tesseract `lang: "spa"`.
- [ ] **Step 2:** Parámetro de render configurable (`scale`) para permitir OCR acotado más adelante; default actual.
- [ ] **Step 3:** Test de integración con un PDF de muestra en `packages/pdf-core/fixtures/` que verifique que se detecta un RFC conocido.
- [ ] **Step 4:** Correr → PASS. Commit `feat(pdf-core): módulo OCR (RFC/nombre/fecha)`.

### Task 4: Migrar censura a `censura.ts` (paridad de comportamiento)

**Files:**
- Create: `packages/pdf-core/src/censura.ts`
- Reference: `server.js` función `censorPdf` y `censurarFirmasLaterales`, `detectarYCensurarFirmaUltimaPagina`

**Interfaces:**
- Consumes: `detectarDatos` de `ocr.ts`.
- Produces: `testarPdf(input: Buffer): Promise<{ bytes: Buffer; rfc: string|null; nombre: string|null; fecha: Date|null }>` — censura SIN cifrar.

- [ ] **Step 1:** Copiar la lógica de censura tal cual (carga de fuentes Montserrat, barras laterales, firma última página, redimensionado). **Quitar** el bloque de cifrado qpdf (líneas `server.js:953-976`) — el cifrado se separa a `cifrado.ts`.
- [ ] **Step 2:** Test de paridad: censurar un PDF fixture y verificar que el número de páginas y dimensiones coinciden con la salida del `server.js` original (snapshot del conteo de objetos de censura).
- [ ] **Step 3:** Correr → PASS. Commit `feat(pdf-core): censura sin cifrado (paridad con server.js)`.

### Task 5: Cifrado/descifrado en `cifrado.ts`

**Files:**
- Create: `packages/pdf-core/src/cifrado.ts`, `packages/pdf-core/src/index.ts`
- Reference: `server.js:953-976`

**Interfaces:**
- Produces:
  - `qpdfDisponible(): boolean`
  - `bloquear(input: Buffer, ownerPwd: string): Buffer` (user-pwd vacío, `--modify=none --print=full`, 256)
  - `desbloquear(input: Buffer, ownerPwd: string): Buffer`

- [ ] **Step 1:** Test: si qpdf no está, `qpdfDisponible()` → false (no lanza). Implementar con `spawnSync("qpdf", ["--version"])`.
- [ ] **Step 2:** Test: `bloquear` produce bytes distintos del input; `desbloquear(bloquear(x))` reabre. Implementar con archivos temporales y los mismos flags actuales.
- [ ] **Step 3:** Exportar todo desde `index.ts`. Correr → PASS. Commit `feat(pdf-core): cifrado bloquear/desbloquear con qpdf`.

---

## Fase 2 — Datos (Prisma / MySQL)

### Task 6: Schema Prisma + migración

**Files:**
- Create: `prisma/schema.prisma`, `apps/api/src/db.ts`
- Modify: `.env.example` (añadir `DATABASE_URL`, `QPDF_OWNER_PASSWORD`)

**Interfaces:**
- Produces: modelos `Empleado`, `Trimestre`, `Contrato`, enum `Estado`; cliente `prisma` singleton.

- [ ] **Step 1:** Escribir `schema.prisma` exactamente como en spec §4 (datasource mysql, generator client).
- [ ] **Step 2:** `npx prisma migrate dev --name init` → crea tablas. Expected: migración aplicada sin error.
- [ ] **Step 3:** `db.ts` exporta singleton de PrismaClient (evita múltiples instancias en dev).
- [ ] **Step 4:** Commit `feat(db): schema Prisma trimestres/contratos + migración inicial`.

---

## Fase 3 — API (Express)

### Task 7: Bootstrap API + cola concurrente

**Files:**
- Create: `apps/api/src/server.ts`, `apps/api/src/cola.ts`
- Test: `apps/api/src/cola.test.ts`

**Interfaces:**
- Produces: `class Cola { constructor(limite: number); add<T>(fn: () => Promise<T>): Promise<T> }` con concurrencia máxima `limite`.

- [ ] **Step 1:** Test de `Cola`: con límite 2, nunca corren más de 2 tareas simultáneas (contador de activos ≤ 2).
- [ ] **Step 2:** Implementar cola simple con contador y waiters. Correr → PASS.
- [ ] **Step 3:** `server.ts`: Express con CORS, json, `static` no necesario (web aparte), límite de subida 50MB, monta routers. Concurrencia = `os.cpus().length - 1`.
- [ ] **Step 4:** Commit `feat(api): bootstrap Express + cola concurrente con tests`.

### Task 8: Servicio de procesamiento de lote + cache/duplicados

**Files:**
- Create: `apps/api/src/servicios/procesarLote.ts`
- Test: `apps/api/src/servicios/procesarLote.test.ts`

**Interfaces:**
- Consumes: `pdf-core` (`calcularHash`, `testarPdf`, `trimestreDeFecha`), `db`.
- Produces: `procesarArchivo(buf, nombre, trimestre?, resolucionDup?)` → registra Empleado/Trimestre/Contrato (estado TESTADO), guarda PDF en ruta física; reutiliza si el hash ya existe (cache); ante duplicado en mismo trimestre devuelve marca para que el cliente elija.

- [ ] **Step 1:** Test: dos veces el mismo buffer → segundo no re-ejecuta OCR (mock) → cache hit.
- [ ] **Step 2:** Test: duplicado (mismo empleado+trimestre) devuelve `{ duplicado: true }` sin sobrescribir.
- [ ] **Step 3:** Implementar (upsert Empleado por RFC, upsert Trimestre por anio+periodo, crear Contrato). Guardar archivo en `contratos/{anio}/T{periodo}/{RFC}_v{n}.pdf`.
- [ ] **Step 4:** Correr → PASS. Commit `feat(api): procesamiento de lote con cache por hash y duplicados`.

### Task 9: Rutas de contratos (testar, progreso, listar, bloquear, desbloquear, eliminar)

**Files:**
- Create: `apps/api/src/rutas/contratos.ts`

**Interfaces:**
- Consumes: `procesarLote`, `cola`, `pdf-core` cifrado, `db`.
- Produces endpoints (spec §9): `POST /api/contratos/testar`, `GET /api/contratos/progreso`, `GET /api/contratos`, `POST /api/contratos/bloquear`, `POST /api/contratos/desbloquear`, `POST /api/contratos/:id/eliminar`.

- [ ] **Step 1:** `POST /testar` con multer memoria, encola cada archivo, responde de inmediato con `loteId`; progreso consultable.
- [ ] **Step 2:** `POST /bloquear` recibe `ids[]`, lee `QPDF_OWNER_PASSWORD` de env, cifra cada uno, estado→BLOQUEADO; si `!qpdfDisponible()` responde 409 con aviso (no silencioso).
- [ ] **Step 3:** `POST /desbloquear` exige contraseña en body, compara con env, descifra, estado→DESBLOQUEADO.
- [ ] **Step 4:** `POST /:id/eliminar` → `eliminado=true` (soft delete).
- [ ] **Step 5:** Probar con `curl`/REST contra un PDF fixture (flujo testar→listar→bloquear). Commit `feat(api): rutas de contratos`.

### Task 10: Rutas de trimestres + respaldo ZIP

**Files:**
- Create: `apps/api/src/rutas/trimestres.ts`

**Interfaces:**
- Produces: `GET /api/trimestres` (con conteos por estado), `GET /api/trimestres/:anio/:periodo/respaldo` (ZIP con archiver de los BLOQUEADOS del trimestre + `errores.txt`).

- [ ] **Step 1:** `GET /trimestres` agrupa contratos no eliminados por anio+periodo con conteos.
- [ ] **Step 2:** `GET /:anio/:periodo/respaldo` arma ZIP (archiver nivel 9) con los PDFs BLOQUEADOS de ese trimestre.
- [ ] **Step 3:** Probar descarga ZIP. Commit `feat(api): rutas de trimestres y respaldo ZIP`.

---

## Fase 4 — Web (Next.js + MUI)

### Task 11: Bootstrap Next.js + tema MUI guinda + cliente REST

**Files:**
- Create: `apps/web/app/layout.tsx`, `apps/web/app/theme.ts`, `apps/web/lib/api.ts`, `apps/web/app/page.tsx` (placeholder), `apps/web/next.config.js`, `apps/web/package.json`

**Interfaces:**
- Produces: tema MUI con `primary.main = "#621132"`; `api` helper (`apiGet`, `apiPost`, `apiUpload`) apuntando a `NEXT_PUBLIC_API_URL`.

- [ ] **Step 1:** Crear app Next 14 App Router + `@mui/material`, `@mui/icons-material`, emotion.
- [ ] **Step 2:** `theme.ts` con paleta guinda (claro `#8a1846`, oscuro `#3d0a1f`), success verde, error rojo; `ThemeProvider` + `CssBaseline` en layout. AppBar con navegación (Subir, Bloquear, Trimestres) con iconos.
- [ ] **Step 3:** `lib/api.ts` con fetch helpers tipados usando `@testado/shared`.
- [ ] **Step 4:** `npm run build -w @testado/web` → compila. Commit `feat(web): bootstrap Next+MUI tema guinda + cliente REST`.

### Task 12: Vista "Subir & Testar"

**Files:**
- Create: `apps/web/app/page.tsx`, `apps/web/components/SubidaArea.tsx`, `apps/web/components/DialogoDuplicado.tsx`, `apps/web/components/ResumenLote.tsx`

**Interfaces:**
- Consumes: `POST /api/contratos/testar`, `GET /api/contratos/progreso`.

- [ ] **Step 1:** Área drag&drop (icono `CloudUpload`), selector de año + trimestre (autodetectado, editable), botón "Testar".
- [ ] **Step 2:** Barra de progreso en vivo (icono `Autorenew` girando) con polling a `/progreso`.
- [ ] **Step 3:** `DialogoDuplicado` (icono `ContentCopy`) con acciones Omitir/Reemplazar/Nueva versión.
- [ ] **Step 4:** `ResumenLote` con tarjetas: Testados (`CheckCircle`), Errores (`ErrorOutline`), Duplicados.
- [ ] **Step 5:** Probar flujo en navegador. Commit `feat(web): vista Subir & Testar`.

### Task 13: Vista "Bloquear"

**Files:**
- Create: `apps/web/app/bloquear/page.tsx`, `apps/web/components/TablaContratos.tsx`

**Interfaces:**
- Consumes: `GET /api/contratos?estado=TESTADO`, `POST /api/contratos/bloquear`.

- [ ] **Step 1:** Tabla MUI de contratos TESTADOS con checkboxes (selección múltiple), columnas RFC/nombre/trimestre/estado (chips con iconos `Lock`/`LockOpen`).
- [ ] **Step 2:** Botón "Bloquear seleccionados" (`Lock`) → POST; manejar 409 (qpdf no disponible) con alerta clara.
- [ ] **Step 3:** Resumen "Bloqueados: N". Probar. Commit `feat(web): vista Bloquear`.

### Task 14: Vista "Trimestres / Respaldos"

**Files:**
- Create: `apps/web/app/trimestres/page.tsx`, `apps/web/components/DialogoDesbloquear.tsx`

**Interfaces:**
- Consumes: `GET /api/trimestres`, `GET /api/trimestres/:anio/:periodo/respaldo`, `POST /api/contratos/desbloquear`.

- [ ] **Step 1:** Navegación año → trimestre (icono `CalendarMonth`) con conteos por estado.
- [ ] **Step 2:** Lista de contratos del trimestre; botón "Descargar respaldo" (`Archive`/`Download`).
- [ ] **Step 3:** `DialogoDesbloquear` pide contraseña (`LockOpen`) → POST desbloquear.
- [ ] **Step 4:** Probar. Commit `feat(web): vista Trimestres y respaldos`.

---

## Fase 5 — Integración y cierre

### Task 15: Prueba end-to-end + paridad de censura

**Files:**
- Create: `docs/superpowers/plans/verificacion-e2e.md` (registro de resultados)

- [ ] **Step 1:** Levantar `dev:api` + `dev:web` + MySQL; subir lote fixture; verificar testar→bloquear→respaldo.
- [ ] **Step 2:** Comparar un PDF censurado nuevo vs salida del `server.js` original (paridad visual de censura).
- [ ] **Step 3:** Verificar cache (re-subir mismo PDF no re-OCR) y duplicados (mismo empleado+trimestre).
- [ ] **Step 4:** Documentar resultados. Commit `test: verificación e2e y paridad de censura`.

---

## Self-Review (cobertura del spec)

- §3 Arquitectura monorepo → Task 1, 6, 7, 11 ✔
- §4 Modelo de datos → Task 6 ✔
- §5 Flujo de estados → Task 8, 9, 12, 13, 14 ✔
- §6 Eficiencia (cache, concurrencia, OCR acotado) → Task 2 (hash), 3 (scale param), 7 (cola), 8 (cache) ✔
- §7 Seguridad (env, qpdf ausente, soft delete) → Task 5, 6, 9 ✔
- §8 Vistas + iconos + color → Task 11, 12, 13, 14 ✔
- §9 Endpoints → Task 9, 10 ✔
- §10 Migración paridad censura → Task 4, 15 ✔
