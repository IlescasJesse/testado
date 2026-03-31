# Guía de Instalación - Testado

## Arquitectura del Sistema

### Servidor Central (Una PC con Node.js)

- Ejecuta el servidor Node.js
- Procesa los PDFs
- Almacena configuraciones y archivos procesados
- **Requiere:** Node.js instalado

### Clientes (Cualquier PC en la red)

- Acceden vía navegador web
- Suben y procesan archivos
- **No requieren:** Node.js ni instalación

## Instalación del Servidor Central

### Requisitos en el Servidor

1. **Node.js** (versión 14 o superior)

   - Descargar de: https://nodejs.org/
   - Verificar instalación: `node --version`

2. **QPDF** (opcional pero recomendado para protección de PDFs)
   - Windows: Descargar de https://github.com/qpdf/qpdf/releases
   - Ejecutar `INSTALAR_QPDF.bat` en la carpeta del proyecto

### Paso 1: Preparar el Servidor

1. Copiar toda la carpeta `testado` a la PC que será el servidor
2. Abrir PowerShell o CMD en la carpeta del proyecto
3. Ejecutar:
   ```bash
   npm install
   ```

### Paso 2: Iniciar el Servidor

```bash
.\iniciar.bat
```

El servidor mostrará:

```
✅ Servidor iniciado en puerto 3001

📍 ACCESOS DISPONIBLES:
   Local:    http://localhost:3001
   Red:      http://192.168.1.100:3001

🌐 Otras PCs pueden acceder usando: http://192.168.1.100:3001
```

**¡Importante!** Anota la IP que muestra (ej: `192.168.1.100`), las otras PCs usarán esta dirección.

## Acceso desde Otras PCs (Clientes)

### ✅ Sin Instalar Nada

1. **Abrir cualquier navegador** (Chrome, Firefox, Edge)
2. **Ir a la dirección:** `http://[IP-DEL-SERVIDOR]:3001`

   Ejemplo: `http://192.168.1.100:3001`

3. **¡Listo!** Ya puedes usar la aplicación completa

### Funcionalidades Disponibles desde Clientes

- ✅ Cargar archivos PDF desde su PC
- ✅ Procesar contratos con censura
- ✅ Descargar archivos procesados
- ✅ Acceder a la configuración
- ✅ Ver carpeta de testados

### Requisitos de Red

**Firewall de Windows:**
La primera vez puede pedir permiso para acceso a red. **Permitir acceso a redes privadas.**

Si hay problemas de conexión:

1. Ir a Panel de Control → Firewall de Windows
2. Permitir aplicación: Node.js
3. O agregar regla para puerto 3001

## Configuración Inicial

### Primera Vez (Desde Cualquier PC)

1. Acceder a la aplicación vía navegador
2. Ir a **Configuración** (botón superior derecho)
3. Cargar un PDF de muestra
4. Hacer clic en **"Cargar Configuración Base"**
5. Ajustar regiones de censura si es necesario
6. Hacer clic en **"Guardar Configuración"**

Esta configuración se guarda en el servidor y estará disponible para todos los clientes.

## Uso Diario

### En el Servidor

1. Ejecutar `iniciar.bat` cada vez que enciendas la PC
2. Dejar la ventana abierta mientras otros usan el sistema
3. Para detener: Presionar `Ctrl+C`

### En los Clientes

1. Abrir navegador
2. Ir a `http://[IP-SERVIDOR]:3001`
3. Usar normalmente (cargar, procesar, descargar)

## Ventajas de esta Arquitectura

✅ **Centralizado** - Todos los archivos procesados en un solo lugar  
✅ **Sin instalaciones** - Los clientes solo necesitan navegador  
✅ **Configuración compartida** - Un solo lugar para ajustar censuras  
✅ **Acceso simultáneo** - Múltiples usuarios pueden trabajar al mismo tiempo  
✅ **Respaldos fáciles** - Solo respaldar la carpeta del servidor

## Características Automáticas

✅ **Auto-creación de directorios** - No necesitas crear carpetas manualmente
✅ **Configuración base única** - Se aplica a todos los contratos
✅ **Configuraciones individuales** - Puedes personalizar contratos específicos
✅ **Encriptación automática** - Si qpdf está instalado
✅ **Renombrado a mayúsculas** - Los archivos procesados se guardan en mayúsculas
✅ **Leyenda de confidencialidad** - Se agrega automáticamente en el lado derecho
✅ **Leyenda de confidencialidad** - Se agrega automáticamente a cada página

## Estructura de Archivos

```
testado/
├── server.js              # Servidor principal
├── index.html             # Interfaz principal
├── settings.html          # Interfaz de configuración
├── renderer.js            # Lógica de procesamiento
├── settings.js            # Lógica de configuración
├── styles.css             # Estilos
├── start.bat              # Iniciar servidor (Windows)
├── contratos/             # (Opcional) PDFs originales
├── tested_Censurado/      # PDFs procesados
├── config/                # Configuraciones
│   └── _CONFIGURACION_UNICA.json
└── temp_uploads/          # Archivos temporales

```

## Solución de Problemas

### El servidor no inicia

- Verificar que Node.js esté instalado: `node --version`
- Verificar que las dependencias estén instaladas: `npm install`
- Revisar que el puerto 3001 no esté en uso

### No se procesan los PDFs

- Verificar que existe `config/_CONFIGURACION_UNICA.json`
- Ir a Configuración y guardar la configuración base
- Revisar la consola del servidor para ver errores

### No se aplica protección

- Instalar qpdf ejecutando `INSTALAR_QPDF.bat`
- O descargar manualmente de https://github.com/qpdf/qpdf/releases

### Los archivos no se renombran a mayúsculas

- Esto es normal, el renombrado ocurre automáticamente al procesar

## Portabilidad

Esta aplicación es completamente portable:

- ✅ Todos los archivos son relativos a la carpeta del proyecto
- ✅ No requiere configuración de rutas absolutas
- ✅ Funciona en cualquier ubicación del sistema
- ✅ Se puede copiar a una USB o compartir en red
- ✅ Los directorios se crean automáticamente

## Soporte

Para más información, revisar:

- `SEGURIDAD_Y_USO.md` - Información de seguridad
- `INSTRUCCIONES_COMPILACION.md` - Compilación de la aplicación
- `README.md` - Información general
