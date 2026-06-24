# Fix TypeScript Infrastructure Debt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saldar la deuda técnica de configuración TypeScript del monorepo: declaraciones de tipos para `pdf-poppler`, arreglo del cast `FontkitModule → Fontkit`, y corrección de `rootDir` en `apps/api` con project references.

**Architecture:** Tres cambios quirúrgicos y aislados. (1) Un archivo `.d.ts` local que declara la forma real de `pdf-poppler` elimina TS7016 sin tocar lógica. (2) Se elimina la interfaz `FontkitModule` vacía en `censura.ts` y se usa directamente el tipo que pdf-lib espera (`Parameters<typeof pdfDoc.registerFontkit>[0]`), sin `any`. (3) Se habilita `composite: true` en `packages/shared` y `packages/pdf-core`, y se agrega `references` en `apps/api` para que `rootDir` pueda volver a `"src"` y la salida quede limpiamente en `apps/api/dist/`.

**Tech Stack:** TypeScript 5+ (NodeNext), project references (`tsc -b`), `pdf-lib`, `@pdf-lib/fontkit`, `pdf-poppler` (sin tipos), `vitest`.

## Global Constraints

- TypeScript estricto (`strict: true`, `noImplicitAny: true`) — CERO `any` explícito ni implícito.
- NO cambiar lógica de negocio — solo tipos y configuración.
- NO tocar `server.js`.
- Los tests de vitest (`npx vitest run`) deben seguir verdes al finalizar cada tarea.
- Branch activa: `rediseno-trimestres`.
- `module: NodeNext` + `moduleResolution: NodeNext` en `tsconfig.base.json` — las importaciones en `.d.ts` deben respetar esta resolución.

---

### Task 1: Declaración de tipos para `pdf-poppler`

**Contexto:** `pdf-poppler` no tiene tipos (`@types/pdf-poppler` no existe). TS lanza TS7016 en `censura.ts:141`, `censura.ts:435`, y `ocr.ts:268` porque hace `import("pdf-poppler") as PopplerModule` donde `PopplerModule` es una interfaz local — pero TS igualmente necesita un declaration file para que el módulo no sea implícitamente `any`.

**Forma real del módulo** (verificada leyendo `node_modules/pdf-poppler/index.js`, `lib/convert.js`, `lib/info.js`, `lib/imgdata.js`):
- `convert(file, opts)` → `Promise<string | null>` (resolve con stdout)
- `info(file)` → `Promise<Record<string, string>>` (metadata del PDF)
- `imgdata(file)` → `Promise<Record<string, string>[]>` (lista de imágenes)
- `path` → `string` (ruta binarios poppler)
- `exec_options` → objeto de opciones para `child_process`

**Files:**
- Create: `packages/pdf-core/types/pdf-poppler.d.ts`
- Modify: `packages/pdf-core/tsconfig.json` (agregar `typeRoots` o `include` para el .d.ts)

**Interfaces:**
- Produces: resolución del módulo `pdf-poppler` sin `any` implícito para toda la compilación de `pdf-core`.

- [ ] **Step 1: Verificar el error actual antes de tocar nada**

```bash
cd C:/Users/ilesm/Documents/testado
npx tsc -p packages/pdf-core/tsconfig.json --noEmit 2>&1 | grep -E "error TS|TS7016|TS2352"
```

Expected: ver las 3 líneas de TS7016 + 1 línea de TS2352.

- [ ] **Step 2: Crear la carpeta `types` en pdf-core**

```bash
mkdir -p C:/Users/ilesm/Documents/testado/packages/pdf-core/types
```

- [ ] **Step 3: Crear `packages/pdf-core/types/pdf-poppler.d.ts`**

El archivo declara la forma real del módulo sin ningún `any`:

```typescript
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
```

- [ ] **Step 4: Actualizar `packages/pdf-core/tsconfig.json` para incluir el .d.ts**

El tsconfig actual es:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Hay dos opciones para que TS encuentre el `.d.ts`:
- Agregar `"types/**/*"` al `include` (más limpio, sin cambiar typeRoots).
- Usar `typeRoots`.

La opción más limpia con NodeNext es agregar al `include`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*", "types/**/*.d.ts"],
  "exclude": ["node_modules", "dist"]
}
```

Editar `packages/pdf-core/tsconfig.json` con este contenido exacto.

- [ ] **Step 5: Verificar que los errores TS7016 desaparecen**

```bash
cd C:/Users/ilesm/Documents/testado
npx tsc -p packages/pdf-core/tsconfig.json --noEmit 2>&1 | grep "TS7016"
```

Expected: sin output (cero líneas con TS7016). Puede quedar el TS2352 todavía — se arregla en Task 2.

- [ ] **Step 6: Correr vitest para confirmar que los tests siguen verdes**

```bash
cd C:/Users/ilesm/Documents/testado
npx vitest run 2>&1 | tail -20
```

Expected: todos los tests pasan (misma cantidad que antes).

- [ ] **Step 7: Commit**

```bash
cd C:/Users/ilesm/Documents/testado
git add packages/pdf-core/types/pdf-poppler.d.ts packages/pdf-core/tsconfig.json
git commit -m "chore(ts): declaración de tipos real para pdf-poppler (elimina TS7016)"
```

---

### Task 2: Arreglar el cast `FontkitModule → Fontkit` (TS2352)

**Contexto:** En `censura.ts:621`, el código hace:
```typescript
pdfDoc.registerFontkit(fontkit as Parameters<typeof pdfDoc.registerFontkit>[0]);
```
Pero `fontkit` está tipado como `FontkitModule` que es `{ [key: string]: unknown }`. La interfaz `Fontkit` en pdf-lib requiere `create(buffer: Uint8Array, ...): Font`. TypeScript no puede realizar el cast de `{ [key: string]: unknown }` a `Fontkit` porque las restricciones de índice de firma genérica con tipos específicos son incompatibles — de ahí el TS2352.

La raíz del problema: la interfaz `FontkitModule` en `censura.ts` solo sirve como "contenedor temporal de cualquier cosa" y tiene un `eslint-disable` para `no-explicit-any` (porque en realidad uses `unknown` en el index signature, lo cual no es `any` pero el ESLint disable es igualmente innecesario).

**Solución:** Eliminar la interfaz `FontkitModule` y tipificar la importación dinámica directamente con `typeof import("@pdf-lib/fontkit")`, que es el módulo exacto con la forma que pdf-lib espera. Así el `as` en `registerFontkit` puede resolverse correctamente o desaparecer completamente.

**Files:**
- Modify: `packages/pdf-core/src/censura.ts` (eliminar interfaz `FontkitModule`, ajustar el cast)

**Interfaces:**
- Consumes: `@pdf-lib/fontkit` — el módulo tiene `export function create(...)` y `export as namespace fontkit`, que satisface `Fontkit` de pdf-lib.
- Produces: `censura.ts` sin errores TS2352, sin `any`, sin `eslint-disable` innecesario.

- [ ] **Step 1: Verificar el error TS2352 exacto**

```bash
cd C:/Users/ilesm/Documents/testado
npx tsc -p packages/pdf-core/tsconfig.json --noEmit 2>&1 | grep "TS2352"
```

Expected: una línea con `censura.ts(621,26): error TS2352`.

- [ ] **Step 2: Leer las líneas 70-75 de censura.ts para ver la interfaz actual**

```
packages/pdf-core/src/censura.ts líneas 70-75:
```
```typescript
/** Módulo @pdf-lib/fontkit (registro en PDFDocument) */
interface FontkitModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: unknown;
}
```

Y líneas 614-621:
```typescript
const fontkit = (await import("@pdf-lib/fontkit")) as FontkitModule;
...
pdfDoc.registerFontkit(fontkit as Parameters<typeof pdfDoc.registerFontkit>[0]);
```

- [ ] **Step 3: Editar `packages/pdf-core/src/censura.ts` — eliminar `FontkitModule` y arreglar el uso**

**3a.** Eliminar el bloque de interfaz `FontkitModule` (líneas 70-74, incluyendo el `eslint-disable`):

Reemplazar este bloque:
```typescript
/** Módulo @pdf-lib/fontkit (registro en PDFDocument) */
interface FontkitModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: unknown;
}
```

Con nada (eliminarlo completamente). El comentario de sección puede quedarse o ajustarse si es necesario para coherencia.

**3b.** En la línea donde se importa fontkit (~línea 615), cambiar:
```typescript
const fontkit = (await import("@pdf-lib/fontkit")) as FontkitModule;
```

Por:
```typescript
const fontkit = await import("@pdf-lib/fontkit");
```

`typeof import("@pdf-lib/fontkit")` produce el tipo del módulo ES, que expone `create` a nivel de módulo. La forma que espera `registerFontkit` es `Fontkit` de pdf-lib que requiere `create(buffer, postscriptName?)`. El módulo `@pdf-lib/fontkit` exporta exactamente esa función, así que la asignación directa funciona si TypeScript puede inferirlo.

**3c.** En la línea donde se llama `registerFontkit` (~línea 621), cambiar:
```typescript
pdfDoc.registerFontkit(fontkit as Parameters<typeof pdfDoc.registerFontkit>[0]);
```

Por:
```typescript
pdfDoc.registerFontkit(fontkit as unknown as Parameters<typeof pdfDoc.registerFontkit>[0]);
```

ESPERA — `as unknown as X` introduce una doble negación que también puede ocultar errores reales. La alternativa correcta es verificar si el tipo del módulo ya satisface `Fontkit`.

**Verificación de compatibilidad:** `@pdf-lib/fontkit` tiene `export function create(...)` y `export as namespace fontkit`. El tipo del módulo dinámico `typeof import("@pdf-lib/fontkit")` tiene `create` como propiedad. pdf-lib's `Fontkit` requiere `{ create(buffer: Uint8Array, postscriptName?: string): Font }`. El módulo ES satisface esta forma, PERO con `module: NodeNext`, el import dinámico devuelve el módulo completo incluyendo todos los re-exports, que puede incluir otras propiedades. TypeScript debería aceptar la asignación directa si la forma es estructuralmente compatible.

Si TypeScript acepta la inferencia directa (sin cast), la línea queda:
```typescript
pdfDoc.registerFontkit(fontkit);
```

Si TypeScript no acepta porque el módulo tiene propiedades adicionales que no están en `Fontkit`, usar:
```typescript
pdfDoc.registerFontkit(fontkit as Parameters<typeof pdfDoc.registerFontkit>[0]);
```

(El cast directo ahora funcionará porque `fontkit` ya no está restringido a `FontkitModule` sino que tiene la forma real del módulo.)

- [ ] **Step 4: Verificar que TS2352 desaparece**

```bash
cd C:/Users/ilesm/Documents/testado
npx tsc -p packages/pdf-core/tsconfig.json --noEmit 2>&1
```

Expected: **0 errores**. Si salen otros errores inesperados, leerlos y corregirlos antes de continuar.

- [ ] **Step 5: Verificar que no hay `any` implícito ni explícito**

```bash
cd C:/Users/ilesm/Documents/testado
grep -n "any" packages/pdf-core/src/censura.ts
```

Expected: ninguna línea con `any` (ni como tipo, ni en comentarios relevantes). Los `eslint-disable` para `no-explicit-any` que ya no sirven deben haberse eliminado en Step 3a.

- [ ] **Step 6: Correr vitest**

```bash
cd C:/Users/ilesm/Documents/testado
npx vitest run 2>&1 | tail -20
```

Expected: todos los tests verdes.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/ilesm/Documents/testado
git add packages/pdf-core/src/censura.ts
git commit -m "chore(ts): eliminar FontkitModule y arreglar cast fontkit sin any (TS2352)"
```

---

### Task 3: Project references para `apps/api` — arreglar `rootDir`

**Contexto:** `apps/api/tsconfig.json` tiene `"rootDir": "../../"` para que TypeScript pueda resolver `@testado/pdf-core` (que apunta a `packages/pdf-core/src/`). Esto es un parche: TS exige que `rootDir` cubra todos los archivos que importa — si importa desde `../../packages/pdf-core/src`, el `rootDir` tiene que ser `../../`. Consecuencia: la salida del build va a `apps/api/dist/apps/api/src/` en vez de `apps/api/dist/`.

**Solución con project references:**
- Habilitar `composite: true` + `declaration: true` en los packages que emiten declaraciones.
- Agregar `"references"` en `apps/api/tsconfig.json` que apunten a los packages.
- Revertir `rootDir` a `"src"` en `apps/api`.
- Ajustar los `paths` en `apps/api/tsconfig.json` para apuntar a los `.d.ts` en `dist/` de cada package.

**Importante sobre NodeNext:** Con `module: NodeNext`, los `paths` del `tsconfig.base.json` resuelven durante el type-checking pero NO en runtime (ts-node, Node.js). El parche actual con `rootDir: ../../` fue puesto para evitar un segundo problema de resolución en runtime. Al usar project references + `paths` apuntando a `dist/*.d.ts`, el type-check queda limpio. Para runtime (dev con `ts-node --esm`), el alias debe resolverse via `tsconfig-paths` o equivalente — esto es una preocupación documentada abajo.

**Files:**
- Modify: `packages/shared/tsconfig.json`
- Modify: `packages/pdf-core/tsconfig.json`
- Modify: `apps/api/tsconfig.json`

**Interfaces:**
- Produces: `npx tsc --build apps/api` compila sin errores y deposita `.js` en `apps/api/dist/` (sin carpetas anidadas).

- [ ] **Step 1: Verificar el estado actual de la salida del build**

```bash
cd C:/Users/ilesm/Documents/testado
npx tsc -p apps/api/tsconfig.json --noEmit 2>&1 | head -30
```

Expected: debe compilar (posiblemente con warnings de `rootDir`) o mostrar la estructura incorrecta si se hace un build real.

- [ ] **Step 2: Actualizar `packages/shared/tsconfig.json` — habilitar composite**

Reemplazar el contenido de `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Actualizar `packages/pdf-core/tsconfig.json` — habilitar composite**

`packages/pdf-core/tsconfig.json` ya tiene `"include": ["src/**/*", "types/**/*.d.ts"]` después de Task 1. Actualizar a:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*", "types/**/*.d.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Nota importante:** Con `composite: true`, el `rootDir` debe cubrir todos los archivos en `include`. El archivo `types/pdf-poppler.d.ts` está fuera de `src/`. Hay dos opciones:
- Opción A: Cambiar `rootDir` a `"."` y aceptar que los `.js` quedan en `dist/src/` — esto rompe el build de outputs.
- Opción B: Mover `pdf-poppler.d.ts` a `src/types/pdf-poppler.d.ts` y actualizar el include.
- Opción C (correcta): Los `.d.ts` en el `include` pero fuera del `rootDir` se aceptan si son solo declaraciones (no emiten JS). TypeScript con `composite: true` requiere que `rootDir` cubra los archivos de implementación, pero los `.d.ts` son solo tipos y no tienen salida JS.

Verificar en Step 5 si TypeScript acepta la Opción C. Si no, implementar Opción B (mover el archivo).

- [ ] **Step 4: Actualizar `apps/api/tsconfig.json` — project references + rootDir correcto**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"],
    "paths": {
      "@testado/shared": ["../../packages/shared/dist/index.d.ts"],
      "@testado/shared/*": ["../../packages/shared/dist/*"],
      "@testado/pdf-core": ["../../packages/pdf-core/dist/index.d.ts"],
      "@testado/pdf-core/*": ["../../packages/pdf-core/dist/*"]
    }
  },
  "references": [
    { "path": "../../packages/shared" },
    { "path": "../../packages/pdf-core" }
  ],
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Nota:** Los `paths` sobrescriben los del `tsconfig.base.json` (los que apuntaban a `src/`). Ahora apuntan a `dist/*.d.ts` que se generan cuando los packages se compilan con `composite: true`. Los `paths` en el tsconfig base apuntan a `src/` — al extender y re-declarar `paths` en `apps/api`, los valores del hijo sobreescriben completamente el objeto (TS no hace merge de `paths`). Confirmar que no quedan referencias a los paths de `src/` en apps/api.

- [ ] **Step 5: Compilar packages primero, luego api**

```bash
cd C:/Users/ilesm/Documents/testado
npx tsc -p packages/shared/tsconfig.json
npx tsc -p packages/pdf-core/tsconfig.json
```

Expected: ambos compilan sin errores y generan `.d.ts` en sus `dist/`.

Si falla pdf-core por el `.d.ts` fuera de `rootDir`, mover el archivo:

```bash
mkdir -p C:/Users/ilesm/Documents/testado/packages/pdf-core/src/types
mv C:/Users/ilesm/Documents/testado/packages/pdf-core/types/pdf-poppler.d.ts \
   C:/Users/ilesm/Documents/testado/packages/pdf-core/src/types/pdf-poppler.d.ts
```

Y actualizar `packages/pdf-core/tsconfig.json` para quitar `"types/**/*.d.ts"` del include (ya lo cubre `src/**/*`).

- [ ] **Step 6: Compilar api con project references**

```bash
cd C:/Users/ilesm/Documents/testado
npx tsc --build apps/api/tsconfig.json 2>&1
```

Expected: 0 errores.

- [ ] **Step 7: Verificar que la salida está en el lugar correcto**

```bash
ls C:/Users/ilesm/Documents/testado/apps/api/dist/
```

Expected: ver archivos `.js` directamente en `dist/` (p.ej. `server.js`, `cola.js`, `db.js`), NO en `dist/apps/api/src/`. Si hay una carpeta `src/` o `apps/` dentro de `dist/`, el `rootDir` no fue corregido.

- [ ] **Step 8: Verificar que `packages/shared` y `packages/pdf-core` compilan sin errores con --noEmit**

```bash
cd C:/Users/ilesm/Documents/testado
npx tsc -p packages/shared/tsconfig.json --noEmit 2>&1
npx tsc -p packages/pdf-core/tsconfig.json --noEmit 2>&1
```

Expected: 0 errores en ambos.

- [ ] **Step 9: Correr vitest para confirmar que todo sigue verde**

```bash
cd C:/Users/ilesm/Documents/testado
npx vitest run 2>&1 | tail -30
```

Expected: todos los tests pasan.

- [ ] **Step 10: Commit**

```bash
cd C:/Users/ilesm/Documents/testado
git add packages/shared/tsconfig.json packages/pdf-core/tsconfig.json apps/api/tsconfig.json
# Si se movió el .d.ts:
git add packages/pdf-core/src/types/pdf-poppler.d.ts
git rm --cached packages/pdf-core/types/pdf-poppler.d.ts 2>/dev/null || true
git commit -m "chore(ts): project references, composite en packages, rootDir correcto en apps/api"
```

---

### Task 4: Commit final unificado + reporte

**Files:**
- Create: `.superpowers/sdd/fix-infra-ts-report.md`

**Interfaces:**
- Consumes: todos los cambios de Tasks 1-3.
- Produces: commit `chore(ts): tipos pdf-poppler, fix cast fontkit y project references del monorepo` + reporte.

- [ ] **Step 1: Verificación final — los 4 objetivos**

```bash
cd C:/Users/ilesm/Documents/testado

echo "=== 1. pdf-core sin errores ==="
npx tsc -p packages/pdf-core/tsconfig.json --noEmit 2>&1 && echo "OK: 0 errores"

echo "=== 2. shared sin errores ==="
npx tsc -p packages/shared/tsconfig.json --noEmit 2>&1 && echo "OK: 0 errores"

echo "=== 3. Build api ==="
npx tsc --build apps/api/tsconfig.json 2>&1 && echo "OK: build exitoso"

echo "=== 3b. Verificar salida api ==="
ls C:/Users/ilesm/Documents/testado/apps/api/dist/

echo "=== 4. Vitest ==="
npx vitest run 2>&1 | tail -20
```

- [ ] **Step 2: Crear directorio y reporte**

```bash
mkdir -p C:/Users/ilesm/Documents/testado/.superpowers/sdd
```

Crear `C:/Users/ilesm/Documents/testado/.superpowers/sdd/fix-infra-ts-report.md` con:
- Qué se declaró en `pdf-poppler.d.ts` (forma del módulo, funciones, tipos).
- Cómo se arregló el cast fontkit (eliminar `FontkitModule`, import directo).
- Configuración de project references usada y por qué.
- Comandos exactos de verificación con su output.
- Hash del commit final.
- Preocupaciones: resolución en runtime con `ts-node --esm` para los paths.

- [ ] **Step 3: Commit final**

```bash
cd C:/Users/ilesm/Documents/testado
git add .superpowers/sdd/fix-infra-ts-report.md
git commit -m "$(cat <<'EOF'
chore(ts): tipos pdf-poppler, fix cast fontkit y project references del monorepo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Reportar estado final al usuario**

Emitir mensaje con: STATUS (OK/BLOCKED), hash del commit, confirmación de los 4 objetivos, y cualquier preocupación (especialmente sobre resolución en runtime con ts-node si se cambió la configuración de paths).

---

## Preocupación importante sobre runtime con ts-node

Al mover los `paths` de `tsconfig.base.json` (`src/`) a `apps/api/tsconfig.json` (`dist/*.d.ts`), el script de dev `"dev": "ts-node --esm src/index.ts"` puede fallar en runtime si `ts-node` no resuelve `@testado/pdf-core` desde `dist/` (que puede no existir o estar desactualizado en dev). 

Opciones para mitigar:
1. Mantener los paths a `src/` en base y agregar los de `dist/` solo para el build — pero TS no permite dos entradas para el mismo path key.
2. Usar `tsconfig-paths` con un `tsconfig.dev.json` para dev que mantenga los paths a `src/`.
3. Documentar que `npm run dev` en `apps/api` requiere que los packages estén compilados primero.

Esto NO bloquea la tarea (el objetivo es el build de producción), pero debe documentarse en el reporte.
