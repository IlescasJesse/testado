# Rediseño Testado — Gestión de Contratos por Trimestre

**Fecha:** 2026-06-23
**Estado:** Diseño aprobado (pendiente revisión final del usuario)
**Autor:** Jesse Ilescas (orquestado con Claude Code)

---

## 1. Contexto y problema

La app actual (`testado/`) es un servidor Express vanilla (`server.js`, ~1300 líneas) que:

- Sube PDFs de contratos.
- Detecta el RFC con OCR (tesseract + poppler) y lo censura ("testa").
- Censura firmas/rúbricas laterales y la firma autógrafa.
- **Siempre** cifra el resultado con `qpdf` (contraseña de apertura vacía, contraseña de edición `F1N4NZ4S2025` en duro).
- Guarda en `tested_Censurado/` y lista los resultados en un array **en memoria** (`processedFiles`, se pierde al reiniciar).

### Necesidades del negocio

- Los empleados firman contrato **cada trimestre** (4 al año). Hace falta archivar y controlar esos contratos por trimestre.
- Poder generar un **respaldo** (ZIP) de los contratos de un trimestre que ya pasó.
- Evitar **duplicados** (mismo empleado, mismo trimestre).
- Separar el **testado** (censura) del **bloqueo** (cifrado): testar deja el PDF abierto; bloquear lo cifra; desbloquear lo reabre.
- Hacer el OCR **mucho más rápido**.
- El OCR y todo el procesamiento corre **solo en esta PC** (servidor central). Los clientes acceden por navegador en la red local y **no instalan nada**.

### Problemas técnicos del código actual

- Estado solo en memoria → se pierde al reiniciar.
- Cifrado acoplado al testado → no hay forma de dejar un PDF abierto ni de desbloquear.
- Contraseña de edición escrita en duro en el código.
- Procesamiento **secuencial** (un PDF a la vez) → lento.
- Sin deduplicación ni cache → reprocesa contenido idéntico.
- `server.js` monolítico de ~1300 líneas, difícil de mantener.
- Si `qpdf` no está, el `catch` ignora el error en silencio → PDFs sin proteger sin aviso.

---

## 2. Decisiones de diseño (acordadas)

| Tema | Decisión |
|---|---|
| Stack | Monorepo npm workspaces: **Next.js 14 (App Router) + MUI v6** (web) + **Express + TypeScript** (api) |
| Base de datos | **MySQL + Prisma** |
| Identidad del empleado | **RFC + nombre** (detectados por OCR) |
| Periodo | **Trimestre** (T1 Ene-Mar, T2 Abr-Jun, T3 Jul-Sep, T4 Oct-Dic) |
| Asignación de trimestre | Autodetectar por fecha del PDF (OCR) **+ confirmación manual** |
| Duplicados | Avisar y dejar elegir: **omitir / reemplazar / nueva versión**. El mismo empleado puede repetir en trimestres distintos; solo es duplicado dentro del mismo trimestre |
| Flujo | **Testar deja el PDF abierto** → "Bloquear" cifra → "Desbloquear" reabre → respaldo por trimestre |
| Arquitectura de despliegue | **Cliente-servidor**: OCR/procesamiento solo en esta PC; clientes por navegador, sin instalación |
| Eficiencia | **Cache por hash** + **cola con concurrencia** (núcleos − 1) + **OCR acotado a región del RFC** |
| Rutas y concurrencia | **Automáticas** (rutas fijas por defecto, concurrencia núcleos − 1). Sin pantalla técnica de ajustes |
| Seguridad de contraseña | Contraseña de edición de qpdf en **variable de entorno** (`.env`), fuera del repo |
| Color principal | **Guinda institucional `#621132`** (claro `#8a1846`, oscuro `#3d0a1f`) |
| Iconos | Material Icons (MUI) en todas las vistas, botones, estados y tarjetas |
| Borrado | **Soft delete** (campo `eliminado`) |

---

## 3. Arquitectura

### 3.1 Monorepo

```
testado/  (npm workspaces)
├─ apps/
│  ├─ web/        → Next.js 14 (App Router) + TypeScript + MUI v6
│  │              UI: Subir&Testar, Bloquear, Trimestres/Respaldos
│  └─ api/        → Express + TypeScript
│                 Endpoints REST, cola de procesamiento, orquestación del pipeline
├─ packages/
│  ├─ shared/     → tipos/DTOs compartidos (Contrato, Trimestre, Estado, etc.)
│  └─ pdf-core/   → lógica pura migrada de server.js:
│                   ocr.ts · censura.ts · cifrado.ts · trimestre.ts · hash.ts
└─ prisma/        → schema.prisma + migraciones (MySQL)
```

`pdf-core` aísla el procesamiento pesado en módulos testeables. `api` orquesta (cola, BD, REST). `web` solo consume REST. Los binarios nativos (tesseract, poppler, qpdf, canvas) viven únicamente en la PC servidor.

### 3.2 Despliegue cliente-servidor

```
        ESTA PC (servidor central)                 CLIENTES (red local)
   ┌──────────────────────────────┐
   │ apps/api (Express)           │            ┌──────────────────┐
   │  ├─ OCR (tesseract+poppler)  │   HTTP/LAN │  Navegador       │
   │  ├─ censura + qpdf           │ ◄────────► │  Next.js servido │
   │  ├─ cola concurrente         │            │  desde esta PC   │
   │  └─ MySQL + Prisma           │            │  cero instalación│
   │ apps/web (Next.js)           │            └──────────────────┘
   └──────────────────────────────┘
```

---

## 4. Modelo de datos (Prisma / MySQL)

```prisma
model Empleado {
  id        Int        @id @default(autoincrement())
  rfc       String     @unique
  nombre    String?
  contratos Contrato[]
}

model Trimestre {
  id        Int        @id @default(autoincrement())
  anio      Int
  periodo   Int        // 1=Ene-Mar, 2=Abr-Jun, 3=Jul-Sep, 4=Oct-Dic
  contratos Contrato[]
  @@unique([anio, periodo])
}

model Contrato {
  id            Int       @id @default(autoincrement())
  empleadoId    Int
  trimestreId   Int
  hash          String    // SHA-256 del PDF original → cache + duplicados
  nombreArchivo String
  rutaArchivo   String    // ubicación física por trimestre
  estado        Estado    @default(TESTADO)
  version       Int       @default(1)
  rfcDetectado  String?
  fechaContrato DateTime? // fecha detectada por OCR
  procesadoEn   DateTime  @default(now())
  bloqueadoEn   DateTime?
  errorMsg      String?
  eliminado     Boolean   @default(false) // soft delete
  empleado      Empleado  @relation(fields: [empleadoId], references: [id])
  trimestre     Trimestre @relation(fields: [trimestreId], references: [id])
  @@unique([empleadoId, trimestreId, version])
  @@index([hash])
}

enum Estado { TESTADO BLOQUEADO DESBLOQUEADO ERROR }
```

- `hash` → cache (mismo contenido = no reprocesar) y detección de duplicados.
- Unicidad `empleado + trimestre + versión` → permite repetir entre trimestres, controla repetidos dentro del mismo.
- Almacenamiento físico: `contratos/{anio}/T{periodo}/{RFC}_v{n}.pdf`.

---

## 5. Flujo de estados

```
Subir PDF
  → calcular hash → ¿existe en BD (mismo empleado+trimestre)?
        sí → avisar duplicado → [Omitir | Reemplazar | Nueva versión]
        no → continuar
  → OCR: detectar RFC + nombre + fecha → deducir trimestre (sugerido)
  → usuario confirma/corrige trimestre
  → Testar (censura RFC + firmas) ──► estado TESTADO (PDF abierto)
  → [Bloquear seleccionados] ──► cifra con qpdf ──► estado BLOQUEADO
  → [Desbloquear seleccionados] (requiere contraseña) ──► estado DESBLOQUEADO
  → [Generar respaldo de trimestre] ──► ZIP de los BLOQUEADOS del trimestre
```

---

## 6. Pipeline y eficiencia

El OCR es el cuello de botella. Estrategias combinadas:

1. **Cache por hash:** si el contenido ya se procesó, se reutiliza y se salta el OCR por completo.
2. **Cola con concurrencia:** procesar `núcleos − 1` PDFs en paralelo (hoy es 1 a la vez).
3. **OCR acotado:** recortar a la región donde está el RFC y bajar la resolución de render (`scale`) a lo mínimo viable, en vez de renderizar la página completa a `scale: 2048`.
4. **Progreso en vivo:** la vista "Testar" muestra avance real (X/Y, tiempo, errores) vía polling o SSE.

---

## 7. Seguridad

- Contraseña de edición de qpdf → **variable de entorno** (`.env`), nunca en el repo.
- Si `qpdf` falta → **avisar y marcar el contrato como no-protegido** (estado/indicador), en vez de ignorar en silencio.
- "Desbloquear" y generar respaldos requieren la contraseña de edición.
- **Soft delete** en lugar de borrado físico.
- Validación de entrada en api (solo PDFs, límites de tamaño/cantidad) y en web.

---

## 8. Vistas (Next.js + MUI) — una por proceso, cada una con su resumen

Tema MUI: primario guinda `#621132`. Material Icons en todo.

1. **📥 Subir & Testar** (`CloudUpload` / `DocumentScanner`)
   - Arrastrar/seleccionar PDFs, elegir/confirmar año + trimestre.
   - Resolución de duplicados (omitir/reemplazar/versión) con `ContentCopy`.
   - Progreso en vivo (`Autorenew` girando) y **resumen final**: "Testados: 48/50 · Errores: 2" (`CheckCircle` / `ErrorOutline`).

2. **🔒 Bloquear** (`Lock`)
   - Lista de contratos en estado TESTADO (abiertos), con selección múltiple.
   - Botón "Bloquear seleccionados" → cifra. Resumen "Bloqueados: 48".

3. **🗂️ Trimestres / Respaldos** (`CalendarMonth`)
   - Navegar año → trimestre, ver contratos y su estado.
   - Generar ZIP de respaldo del trimestre (`Archive` / `Download`).
   - Desbloquear con contraseña (`LockOpen`).

Iconografía base: `Badge`/`Person` (empleado/RFC), `Search` (buscar), `DeleteOutline` (soft delete).

---

## 9. Endpoints REST (api)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/contratos/testar` | Subir lote, detectar duplicados, OCR, censura, estado TESTADO |
| GET  | `/api/contratos/progreso` | Progreso del lote en curso (X/Y, errores) |
| GET  | `/api/contratos` | Listar contratos (filtros: estado, trimestre, empleado) |
| POST | `/api/contratos/bloquear` | Cifrar contratos seleccionados (→ BLOQUEADO) |
| POST | `/api/contratos/desbloquear` | Descifrar seleccionados (requiere contraseña) |
| GET  | `/api/trimestres` | Listar trimestres con conteos |
| GET  | `/api/trimestres/:anio/:periodo/respaldo` | ZIP de respaldo del trimestre |
| POST | `/api/contratos/:id/eliminar` | Soft delete |

---

## 10. Migración

- Migrar la lógica de PDF de `server.js` a `packages/pdf-core` **sin cambiar su comportamiento de censura** (es código probado en producción).
- El `server.js` actual queda como referencia hasta validar paridad de censura.
- Datos existentes en `tested_Censurado/` se pueden importar a la BD con un script de un solo uso (opcional, fuera del alcance inicial).

---

## 11. Fuera de alcance (YAGNI por ahora)

- Autenticación de usuarios/roles (se asume red interna confiable).
- Pantalla de ajustes técnicos (rutas/concurrencia son automáticas).
- Migración masiva del histórico previo (script opcional posterior).
- Versión Electron de escritorio (la app es cliente-servidor por navegador).
