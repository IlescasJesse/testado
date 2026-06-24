# Cómo usar TESTADO — Sistema de gestión de contratos PDF

## Requisitos previos

Antes de arrancar, asegúrate de tener lo siguiente instalado en la PC:

| Requisito | Versión mínima | Notas |
|-----------|----------------|-------|
| Node.js | 18 o superior | https://nodejs.org |
| MySQL / MariaDB | cualquiera reciente | Debe estar corriendo como servicio |
| qpdf | 12.x | Para cifrado de PDFs |
| Tesseract OCR | 5.x | Para reconocimiento de RFC |
| poppler | cualquiera | Viene incluido con la dependencia `pdf-poppler` |

La base de datos debe llamarse `testado` y el acceso configurado en el archivo `.env` en la raíz del proyecto.

---

## Cómo arrancar el sistema

### Opción A — Doble clic (recomendado para operadores)

1. Abre el Explorador de Windows y ve a la carpeta del proyecto.
2. Haz doble clic en **`iniciar.bat`**.
3. El script instalará dependencias si es la primera vez, compilará el código y levantará la API y la interfaz web.
4. Abre tu navegador en **http://localhost:3000**.

> Si sale un aviso de "Puerto 3001 ocupado", la API usará el puerto 3010 automáticamente. Nada cambia para el operador.

### Opción B — Desde la terminal (para técnicos)

```bat
cd C:\ruta\al\proyecto\testado
npm install          # solo la primera vez
npm run build        # compila packages + API + Web
npm start            # levanta API y Web juntos
```

O arrancar por separado en dos terminales:

```bat
:: Terminal 1 — API
set PORT=3001
npm run start:api

:: Terminal 2 — Web
npm run start:web
```

---

## Acceder al sistema

| Desde | URL |
|-------|-----|
| Esta PC | http://localhost:3000 |
| Otros equipos en la red | http://IP-DE-ESTA-PC:3000 |

Para conocer la IP de esta PC: abre `cmd` y escribe `ipconfig`. Busca la línea "Dirección IPv4".

---

## Flujo de trabajo

### 1. Subir y Testar contratos (`/` — página principal)

1. Arrastra uno o varios archivos PDF al área de carga (o haz clic para seleccionar).
2. Opcionalmente elige el **año** y **trimestre** del contrato. Si no los indicas, el sistema los detecta automáticamente desde la fecha del contrato.
3. Haz clic en **Testar**.
4. El sistema ejecuta OCR, censura datos personales (RFC, firma) y guarda el PDF censurado en la carpeta `tested_Censurado/`.
5. Al terminar verás el resultado: `Testado`, `Caché` (ya procesado antes) o `Error`.
6. Si se detectan **duplicados**, el sistema preguntará qué hacer: omitir, reemplazar o guardar como nueva versión.

### 2. Bloquear contratos (`/bloquear`)

Una vez testados, los contratos deben bloquearse (cifrarse) antes del respaldo trimestral.

1. Ve a la pestaña **Bloquear**.
2. Filtra por trimestre si quieres.
3. Selecciona los contratos y haz clic en **Bloquear seleccionados**.
4. El sistema cifrará los PDFs con qpdf usando la contraseña configurada en el servidor.

### 3. Generar respaldo trimestral (`/trimestres`)

1. Ve a la pestaña **Trimestres**.
2. Verás la lista de trimestres con conteos de contratos por estado.
3. Haz clic en **Descargar respaldo** en el trimestre que necesites.
4. El sistema descarga un archivo ZIP con todos los PDFs **BLOQUEADOS** de ese trimestre, más un `manifiesto.txt`.

---

## Notas técnicas

- Los archivos censurados se guardan en `tested_Censurado/{año}/T{periodo}/{RFC}_v{n}.pdf`.
- La clave de cifrado se configura en `.env` bajo `QPDF_OWNER_PASSWORD`.
- El servidor legacy `server.js` (si está corriendo en el puerto 3001) es independiente y no interfiere con la nueva API.
- Los tests se ejecutan con `npm test` desde la raíz del proyecto.
