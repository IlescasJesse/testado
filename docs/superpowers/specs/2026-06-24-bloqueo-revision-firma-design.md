# Diseño — Mejoras en Bloqueo y Revisión de Firma

**Fecha:** 2026-06-24
**Estado:** Aprobado (pendiente de implementación, prevista para la tarde del 2026-06-24)
**Autor:** Jesse + Claude

## Contexto

App Testado (monorepo Next + Express + Prisma). Dos áreas a mejorar:

1. **Vista Bloquear** (`apps/web/app/bloquear/page.tsx`): hoy solo los contratos en
   estado `TESTADO` se pueden seleccionar para bloquear; los `DESBLOQUEADO` quedan
   inertes (no se pueden re-cifrar desde la UI).
2. **Censura de la firma en la última página** (`packages/pdf-core/src/censura.ts`):
   cuando no se detecta el ancla "PRESTADOR DE SERVICIOS", se aplica un recuadro
   negro fijo (`aplicarFallbackFirmaUltimaPagina`) que a veces no coincide con la
   firma real, dejándola visible. No hay forma de señalar ni corregir esos casos.

### Aclaración sobre el cifrado (sin cambios)

El cifrado actual (`packages/pdf-core/src/cifrado.ts`, función `bloquear`) ya cumple
el requisito del usuario: **user-password vacío** (el PDF se abre y se ve sin
contraseña) + **owner-password con `--modify=none`** (no se puede editar sin la
contraseña). Es decir, el bloqueo restringe **solo la edición, no la apertura**.
No requiere cambios. (Hoy permite impresión con `--print=full`; se deja así salvo
indicación contraria.)

## Decisiones tomadas

- Seleccionables/bloqueables en la vista: **`TESTADO` + `DESBLOQUEADO`**.
- Problema de firma a resolver: **a veces la firma queda visible** cuando falla la
  detección → se requiere cobertura más robusta **y** señalización + corrección manual.
- Fallback extremo (sin ninguna detección): **banda amplia + marcar para revisión
  manual**.
- En el visor, el operador necesita **tapar la firma manualmente** (dibujar recuadro).
- "Marcar como terminado" en el visor = **quitar el flag de revisión Y cifrar
  (bloquear)** en un solo paso.

## Arquitectura — descomposición en 3 fases

Cada fase es entregable e independientemente verificable.

---

### Fase 1 — Vista Bloquear: seleccionar testados + desbloqueados

**Objetivo:** permitir seleccionar y bloquear contratos `TESTADO` y `DESBLOQUEADO`.

**Frontend — `apps/web/app/bloquear/page.tsx`:**
- Definir el conjunto de estados seleccionables: `["TESTADO", "DESBLOQUEADO"]`.
- `testadosIds` → renombrar a `seleccionablesIds` = contratos cuyo estado está en
  ese conjunto. Usar esta lista en `handleSelectAll`, `allSelected`,
  `someSelected` y en el `disabled` del checkbox de fila.
- Contador con desglose cuando hay mezcla: "N seleccionados (X testados, Y
  desbloqueados)".
- El botón sigue siendo "Bloquear seleccionados" (mismo endpoint).

**Backend — `apps/api/src/rutas/contratos.ts` (POST `/bloquear`):**
- Salvaguarda: antes de cifrar cada contrato, verificar que su `estado` sea
  `TESTADO` o `DESBLOQUEADO`. Si está `BLOQUEADO` o `ERROR`, omitir y registrar en
  `errores` (evita re-cifrar un PDF ya cifrado, que lo corrompería con doble qpdf).

**Tests:** `contratos.test.ts` — bloquear un `DESBLOQUEADO` funciona; bloquear un
`BLOQUEADO` se rechaza/omite.

---

### Fase 2 — Flag "revisar firma"

**Objetivo:** marcar automáticamente los contratos cuya firma se cubrió "a ciegas"
(fallback sin detección), para revisión posterior.

**`packages/pdf-core/src/censura.ts`:**
- `detectarYCensurarFirmaUltimaPagina` devuelve el nivel de cobertura usado:
  `"ancla" | "nombre" | "fallback"`.
  - `"ancla"`: detección actual por "PRESTADOR/SERVICIOS".
  - `"nombre"` (nuevo): si falla el ancla, buscar el **nombre del empleado**
    (detectado por OCR) en el TSV de la última página y tapar la banda
    inmediatamente **encima** del nombre, sin cubrir el nombre.
  - `"fallback"` (nuevo): si nada se detecta, **banda amplia centrada** en la zona
    típica de firmas (más generosa que el recuadro fino actual).
- `testarPdf` propaga `firmaRevisionManual: boolean` (= `true` solo cuando el nivel
  fue `"fallback"`). Añadir el campo al objeto de retorno y a `ResultadoCensura`.

**`prisma/schema.prisma`:**
- `Contrato`: nuevo campo `requiereRevision Boolean @default(false)`.
- Migración con `npm run prisma:migrate` (MariaDB local).

**`apps/api/src/servicios/procesarLote.ts`:**
- En los dos `prisma.contrato.create`, persistir
  `requiereRevision: firmaRevisionManual`.

**Propagación a la UI:**
- `packages/shared/src/index.ts` → `ContratoDTO`: añadir `requiereRevision: boolean`.
- `apps/api/src/rutas/contratos.ts` (GET `/`): incluir `requiereRevision` en el DTO
  aplanado.
- `apps/web/app/bloquear/page.tsx`: chip de advertencia ⚠ **"Revisar firma"** en
  las filas con `requiereRevision === true`. No bloquea el bloqueo; solo señala.

**Tests:** `censura.test.ts` (niveles `"nombre"` y `"fallback"`),
`procesarLote.test.ts` (persistencia del flag).

---

### Fase 3 — Editor manual en el visor + "finalizar"

**Objetivo:** permitir al operador tapar la firma manualmente sobre el PDF y, en un
solo paso, quitar el flag y cifrar (bloquear).

**Visor — `apps/web/components/VisorPdf.tsx` (reescritura):**
- Reemplazar el `<iframe>` por render con **`react-pdf`** (pdf.js sobre canvas),
  para poder dibujar encima.
- Herramienta de dibujo de **recuadros negros** (uno o varios) sobre la página, con
  navegación entre páginas. Estado local de anotaciones:
  `Array<{ pagina: number; x: number; y: number; w: number; h: number }>` en
  coordenadas normalizadas (0–1) respecto al tamaño de página para mapear sin
  ambigüedad de escala.
- Botón **"Guardar y bloquear"** (visible/relevante para contratos marcados; la
  herramienta de dibujo puede ofrecerse en general).

**Backend — nuevo endpoint `POST /:id/censura-manual` en `contratos.ts`:**
1. Recibe `{ anotaciones: Array<{ pagina, x, y, w, h }> }` (coords normalizadas).
2. Aplica los recuadros negros con `pdf-lib` (helper nuevo en `pdf-core`, p. ej.
   `aplicarAnotaciones(bytes, anotaciones)`), convirtiendo coords normalizadas a
   puntos PDF por página.
3. Escribe el PDF resultante a `rutaArchivo`.
4. `requiereRevision = false`.
5. Cifra con qpdf (`bloquear`) → estado `BLOQUEADO`, `bloqueadoEn = now()`.
   Reutiliza la validación de `qpdfDisponible` y `QPDF_OWNER_PASSWORD` del endpoint
   `/bloquear`.
- Validaciones: id válido, contrato no eliminado, estado en `{TESTADO,
  DESBLOQUEADO}`, anotaciones bien formadas (coords en 0–1, página dentro de rango).

**Dependencia nueva:** `react-pdf` en `apps/web`.

**Tests:** helper `aplicarAnotaciones` en `pdf-core`; endpoint `censura-manual` en
`contratos.test.ts` (aplica recuadro, quita flag, cifra; rechaza coords inválidas).

## Consideraciones transversales

- **Coordenadas normalizadas (0–1)** entre frontend y backend para evitar problemas
  de escala/DPI entre el render de pdf.js y el tamaño real de página de pdf-lib.
- **Criterio de seguridad:** ante incertidumbre, cubrir de más antes que dejar la
  firma visible. El único dato que nunca se tapa por el fallback automático es el
  **nombre del empleado** (no se censura).
- **Idempotencia del bloqueo:** la salvaguarda de estado en `/bloquear` y en
  `censura-manual` evita el doble cifrado.

## Fuera de alcance (YAGNI)

- Impedir impresión del PDF (se mantiene `--print=full`).
- Edición manual de otras censuras (RFC, franjas laterales) — solo firma última página.
- Historial/auditoría de quién revisó manualmente (no solicitado).

## Orden de implementación

Fase 1 → Fase 2 → Fase 3. Cada fase se planifica y ejecuta por separado; la Fase 1
es la primera a planificar.
