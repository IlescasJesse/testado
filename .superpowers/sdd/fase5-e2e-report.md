# Fase 5 — Reporte E2E (Integración Final)

Fecha: 2026-06-24

## Resumen Ejecutivo

El E2E completo (testar → bloquear → respaldo) **FUNCIONÓ** con el contrato real `ACEVEDO MESINAS JOSIMAR.pdf`.
RFC detectado correctamente: `AEMJ890328B87`.

---

## Resultados E2E paso a paso

### a) POST /api/contratos/testar

```
HTTP 200
body: { success: true, loteId: "1782312242041-0", total: 1, processing: true }
```

### b) Polling progreso hasta completado

```
Polls: 10 intentos × 3s = ~30s (OCR es la operación más lenta)
Resultado:
{
  "estado": "testado",
  "contratoId": 1,
  "rfc": "AEMJ890328B87",
  "nombre": "ACEVEDO MESINAS JOSIMAR",
  "trimestre": { "anio": 2025, "periodo": 1 },
  "version": 1
}
RFC esperado: AEMJ890328B87 | detectado: AEMJ890328B87 | OK=true
Archivo censurado creado: tested_Censurado/2025/T1/AEMJ890328B87_v1.pdf (8852.2 KB)
```

### c) GET /api/contratos?estado=TESTADO

```
HTTP 200
Total TESTADO: 1
Contrato id=1 en lista: true
```

### d) POST /api/contratos/bloquear

```
HTTP 200
body: { success: true, bloqueados: 1, errores: [] }
qpdf --show-encryption output:
  R = 6
  P = -1324
  User password =
  Supplied password is user password
  extract for accessibility: allowed
  print low resolution: allowed
  print high resolution: allowed
  modify document assembly: not allowed
  modify forms: not allowed
  modify annotations: not allowed
→ Cifrado AES-256 confirmado (R=6)
```

### e) Re-subir mismo PDF (cache)

```
Estado re-subida: cache
Mensaje: "Archivo ya procesado anteriormente (cache por hash)."
→ No re-procesa, devuelve datos existentes por hash SHA-256
```

### f) GET /api/trimestres

```
HTTP 200
trimestres: [{
  anio: 2025, periodo: 1,
  total: 1, testados: 0, bloqueados: 1, desbloqueados: 0, errores: 0
}]
```

### g) GET /api/trimestres/2025/1/respaldo

```
HTTP 200
Content-Type: application/zip
ZIP size: 8,916,429 bytes (~8.5 MB)
→ ZIP no vacío con el contrato bloqueado y manifiesto.txt
```

---

## Fixes aplicados durante la fase

### Fix 1 — Prisma 7 → Prisma 5 (incompatibilidad crítica)
**Problema**: Prisma 7 eliminó el motor binario. `new PrismaClient()` lanza `PrismaClientInitializationError: Using engine type "client" requires either "adapter" or "accelerateUrl"`. No existe `@prisma/adapter-mysql2` en npm.  
**Fix**: Downgrade a `prisma@5.22.0` + `@prisma/client@5.22.0`. Prisma 5 usa binario nativo y lee `DATABASE_URL` de env.  
**Archivos**: `package.json` (raíz), `prisma/schema.prisma` (restaurado + añadido `url = env("DATABASE_URL")`).

### Fix 2 — Campo multer: `archivos` → `pdfs`
**Problema**: El frontend web enviaba el campo multipart con nombre `pdfs` pero la API esperaba `archivos`.  
**Fix**: Cambiado `upload.array("archivos")` → `upload.array("pdfs")` en `contratos.ts`.  
**Archivos**: `apps/api/src/rutas/contratos.ts`, tests actualizados en `apps/api/src/rutas/contratos.test.ts`.

### Fix 3 — dotenv loading en server.ts
**Problema**: La API no cargaba el archivo `.env`. Prisma necesita `DATABASE_URL` como env var.  
**Fix**: Añadido `import "dotenv/config"` al inicio de `apps/api/src/server.ts`. Añadida dependencia `dotenv` en `apps/api/package.json`.

### Fix 4 — Package exports apuntaban a `.ts` source
**Problema**: `packages/pdf-core/package.json` y `packages/shared/package.json` tenían `"main": "./src/index.ts"`. Node en modo CJS intentaba cargar TypeScript directamente.  
**Fix**: Cambiado `main` a `./dist/index.js` con exports condicionales CJS/ESM en ambos paquetes.

### Fix 5 — fontkit dynamic import en CJS
**Problema**: `import("@pdf-lib/fontkit")` en CJS compilado devuelve el namespace ESM completo, no el default export. `pdfDoc.registerFontkit(fontkit)` fallaba con `fontkit.create is not a function`.  
**Fix**: Añadida lógica de fallback: `const fontkitInst = fontkitMod.default ?? fontkitMod` en `packages/pdf-core/src/censura.ts`.

---

## Scripts de arranque

En `package.json` raíz (nuevos):

| Script | Descripción |
|--------|-------------|
| `npm run build:packages` | Compila shared + pdf-core con `tsc -b` |
| `npm run build:api` | Compila apps/api |
| `npm run build:web` | Build de producción Next.js |
| `npm run build` | Los tres en orden |
| `npm run start:api` | `node dist/server.js` (usa PORT env, default 3001) |
| `npm run start:web` | `next start` en puerto 3000 |
| `npm start` | API + Web juntos con `concurrently` |

Archivo `iniciar.bat` actualizado: verifica Node.js, instala deps, compila y levanta API + Web en ventanas separadas. Detecta automáticamente si el puerto 3001 está ocupado y usa 3010.

---

## Estado de puertos en esta máquina

| Puerto | Proceso |
|--------|---------|
| 3001 | `server.js` legacy (process node, independiente) |
| 3000 | Proceso PM2 (proceso existente previo) |

La nueva API se levanta en puerto **3010** cuando 3001 está ocupado.

---

## Output de vitest (final)

```
Test Files  9 passed (9)
Tests       71 passed | 1 skipped (72)
Duration    ~31s
```

## Output de npm run build (completo)

```
build:packages → tsc -b packages/shared packages/pdf-core   ✓
build:api      → tsc -p tsconfig.json                        ✓
build:web      → next build                                   ✓
  Route (app)    / → 8.54 kB   First Load 172 kB
  Route (app)    /bloquear → 11.7 kB
  Route (app)    /trimestres → 3.49 kB
```

---

## Pendientes / Notas para el usuario

1. **Puerto 3001 ocupado**: El `server.js` legacy ocupa el puerto 3001. Para liberar ese puerto y usar `npm start` limpiamente (API en 3001), hay que cerrar el servidor legacy primero.
2. **Base de datos vacía en staging**: La BD `testado` quedó con los datos del E2E (1 empleado, 1 trimestre, 1 contrato bloqueado). Limpiar con `prisma db push --force-reset` si se quiere empezar limpio.
3. **PDF de prueba no commiteado**: `contratos/ACEVEDO MESINAS JOSIMAR.pdf` está en `.gitignore`, no fue al repositorio.
4. **prisma.config.ts**: Este archivo es formato Prisma 7 (con `defineConfig`). Ya no es compatible con Prisma 5. Se dejó en el repo pero es ignorado por `prisma` CLI v5. Se puede eliminar sin consecuencias.
5. **prisma migrate vs db push**: El proyecto usa `prisma db pull` + schema manual. Las migraciones formales no están versionadas. Para despliegue en nuevo servidor usar `npx prisma db push`.
