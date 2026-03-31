# Instrucciones de Compilación - Testado v1.0.0

## IMPORTANTE: Pasos para crear el ejecutable de Windows

### Paso 1: Esperar a que termine la instalación de npm

Si ves el cursor parpadeante en la terminal, espera a que npm termine de descargar e instalar todas las dependencias.
Esto puede tomar entre 5-15 minutos dependiendo de tu conexión de internet.

### Paso 2: Verificar la instalación

Abre una nueva terminal en la carpeta del proyecto y ejecuta:

```
npm --version
node --version
```

### Paso 3: Crear el ejecutable

Una vez instaladas las dependencias, ejecuta:

```
npm run build-win
```

Esto generará:

- `dist/Testado Setup 1.0.0.exe` - Instalador
- `dist/Testado 1.0.0.exe` - Ejecutable portable (no requiere instalación)

### Paso 4: Ejecutar la aplicación

**En modo desarrollo**:

```
npm start
```

**Desde el ejecutable compilado**:
Haz doble clic en `dist/Testado 1.0.0.exe`

## Estructura de archivos creados:

✅ **Archivos de configuración**:

- `package.json` - Dependencias y scripts
- `main.js` - Proceso principal de Electron
- `preload.js` - API de seguridad

✅ **Interfaz gráfica**:

- `index.html` - Pantalla principal
- `settings.html` - Panel de configuración
- `styles.css` - Estilos globales
- `renderer.js` - Lógica de la interfaz
- `settings.js` - Lógica de configuración

✅ **Procesamiento de PDFs**:

- `index.js` - Funciones de censura (exportadas para Electron)

✅ **Scripts útiles**:

- `start.bat` - Inicia la aplicación (Windows)
- `start.sh` - Inicia la aplicación (Linux/Mac)

## Dependencias instaladas:

### Producción:

- `pdf-lib` - Manipulación de PDFs
- `pdfjs-dist` - Visualización de PDFs

### Desarrollo:

- `electron` - Framework de escritorio
- `electron-builder` - Compilador para crear .exe

## Configuración de compilación (package.json):

La configuración de `electron-builder` incluye:

- Destino: NSIS + Portable
- Arquitectura: x64
- Ícono: `build/icon.png` (crear si es necesario)
- Acceso directo en el escritorio
- Entrada en el menú de inicio

## Ícono personalizado (OPCIONAL):

Si quieres un ícono personalizado para el ejecutable:

1. Crea una imagen PNG de 256x256 píxeles
2. Colócala en `build/icon.png`
3. Ejecuta `npm run build-win` nuevamente

## Troubleshooting:

Si encuentras errores:

1. **Error: "Cannot find module electron"**

   - Solución: Ejecuta `npm install` nuevamente

2. **El .exe no se crea**

   - Verifica que tengas suficiente espacio en disco
   - Intenta ejecutar PowerShell como administrador

3. **Error al procesar PDFs**
   - Asegúrate de que los archivos en `contratos/` son PDFs válidos

---

Para más ayuda, consulta el archivo `README.md`
