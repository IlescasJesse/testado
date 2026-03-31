# Testado - Gestor de Contratos con Interfaz Gráfica

## Descripción

Aplicación de escritorio para Windows 11 que permite seleccionar contratos en PDF, previsualizarlos, ajustar regiones de censura y procesar múltiples archivos.

## Características

- ✅ **Selector de Contratos**: Interfaz para seleccionar PDFs de la carpeta `contratos/`
- ✅ **Tabla de Seleccionados**: Visualización de contratos seleccionados
- ✅ **Botón Abrir Carpeta**: Acceso directo a la carpeta de archivos testados
- ✅ **Panel de Configuración**:
  - Vista previa de PDFs página por página
  - Indicadores de coordenadas (X, Y, Ancho, Alto en mm)
  - Controles direccionales (↑↓←→) para mover regiones
  - Ajuste de tamaño de regiones
  - Selector de color (por defecto negro)
  - Guardar y cargar configuraciones
- ✅ **Diseño Profesional**: Color primario #9D2449
- ✅ **Ejecutable Windows**: Compilado con Electron

## Instalación y Compilación

### Requisitos

- Node.js v16+
- npm
- Windows 11 (o Windows 10+)

### Pasos

1. **Instalar dependencias**:

   ```
   npm install
   ```

2. **Ejecutar en modo desarrollo**:

   ```
   npm start
   ```

3. **Compilar ejecutable para Windows**:
   ```
   npm run build-win
   ```

El archivo `.exe` se generará en la carpeta `dist/` con un instalador NSIS.

## Estructura de Carpetas

```
testado/
├── contratos/           # Carpeta donde se colocan los PDFs a testear
├── tested_Censurado/    # Carpeta donde se guardan los PDFs procesados
├── config/              # Archivos de configuración guardadas
├── main.js              # Proceso principal de Electron
├── preload.js           # API segura para el renderer
├── renderer.js          # Lógica de la interfaz principal
├── settings.js          # Lógica del panel de configuración
├── index.html           # Interfaz principal
├── settings.html        # Panel de configuración
├── styles.css           # Estilos de la aplicación
├── index.js             # Lógica de procesamiento de PDFs
└── package.json         # Configuración del proyecto
```

## Uso

### 1. Selector de Contratos

- Coloca los archivos PDF en la carpeta `contratos/`
- La aplicación los listará automáticamente
- Selecciona los que deseas procesar
- Haz clic en **"Procesar Contratos"**

### 2. Panel de Configuración

- Haz clic en **"⚙️ Configuración"**
- Selecciona un contrato de la lista desplegable
- Navega entre páginas con los botones Anterior/Siguiente
- Ajusta la región de censura:
  - **Botones direccionales**: Mueve la región (↑↓←→)
  - **Botones de tamaño**: Aumenta/disminuye ancho y alto
  - **Color picker**: Selecciona el color de censura
- Guarda la configuración con **"💾 Guardar Configuración"**

### 3. Abrir Carpeta de Testados

- Haz clic en **"📂 Abrir Carpeta Testados"**
- Se abrirá automáticamente la carpeta con los PDFs procesados

## Configuración de Regiones

Las regiones de censura se miden en **milímetros (mm)** y se pueden ajustar de manera interactiva:

- **Coordenadas X, Y**: Posición de la región
- **Ancho, Alto**: Dimensiones de la región
- **Color**: Color de la censura (por defecto negro)

Las configuraciones se guardan por contrato y se pueden cargar posteriormente.

## Notas Técnicas

- **Electron v27**: Framework para crear ejecutables de escritorio
- **PDF-lib**: Procesamiento y manipulación de PDFs
- **PDF.js**: Visualización de PDFs en el navegador
- **Electron-builder**: Compilación del ejecutable para Windows

## Solución de Problemas

### Si los PDFs no se cargan:

1. Asegúrate de que la carpeta `contratos/` existe
2. Verifica que los archivos sean PDFs válidos
3. Reinicia la aplicación

### Si el ejecutable no funciona:

1. Instala .NET Framework si es necesario
2. Descarga la versión más reciente desde `dist/`
3. Ejecuta el instalador NSIS

### Si hay errores de permisos:

1. Abre PowerShell como administrador
2. Ejecuta `npm install` nuevamente

## Roadmap Futuro

- [ ] Soporte para múltiples formatos (DOCX, JPG)
- [ ] Historial de cambios
- [ ] Exportación de reportes
- [ ] Sincronización en la nube

## Autor

Desarrollo para gestión automatizada de censura de contratos

---

**Versión**: 1.0.0
**Última actualización**: 3 de diciembre de 2024
# testado
