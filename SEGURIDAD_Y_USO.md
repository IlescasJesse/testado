# TESTADO - Sistema de Censura de Contratos

## 🔐 Características de Seguridad

### Protección contra Edición

Los PDFs procesados están protegidos con:

- **Contraseña de propietario**: `F1N4NZ4S2025`
- **Encriptación AES-256**
- **Modificación bloqueada**: No se pueden editar ni modificar
- **Impresión permitida**: Se puede imprimir sin restricciones

### Requisito: QPDF

Para aplicar la protección, necesitas tener instalado **qpdf**.

#### Instalación en Windows

**Opción 1: Con Chocolatey (Recomendado)**

```powershell
# Como Administrador en PowerShell
choco install qpdf -y
```

**Opción 2: Script automático**
Ejecuta el archivo `INSTALAR_QPDF.bat` incluido en esta carpeta.

**Opción 3: Descarga manual**

1. Ve a https://qpdf.sourceforge.io/
2. Descarga la versión para Windows
3. Instala y asegúrate de agregarlo al PATH del sistema

### Verificar instalación

```powershell
qpdf --version
```

## 📋 Configuración de Censura

### Página 2 (Índice 1)

- **Región 3**: Censura texto en **negrita/BOLD** (color negro)
  - Coordenadas: X=127.1mm, Y=94.4mm
  - Tamaño: 31.7mm × 4mm
  - Color: Negro (#000000)
  - Flag especial: `"censorBold": true`

### Página 6 (Índice 5)

- **Región 3**: Censura inteligente de firmas azules
  - Solo censura si detecta contenido en zona de firma
  - Flag especial: `"smartCensor": true`

### Todas las páginas

- Barras laterales blancas (izquierda y derecha)
- Se mantienen en todas las hojas

## 🔄 Procesamiento

### Al procesar PDFs:

1. ✅ Aplica regiones de censura configuradas
2. ✅ Encripta con qpdf (si está instalado)
3. ✅ Renombra archivos a MAYÚSCULAS
4. ✅ Guarda en carpeta `tested_Censurado/`

### Flujo completo:

```
PDF original → Censura → Encriptación → MAYÚSCULAS → tested_Censurado/
```

## 🌐 Uso en Red

### Servidor Local

```
http://localhost:3001
```

### Otra PC en la red

```
http://[IP-DEL-SERVIDOR]:3001
```

### Obtener IP del servidor

```powershell
ipconfig
# Busca "Dirección IPv4"
```

## 🛡️ Seguridad Adicional

### Desencriptar un PDF (solo con contraseña)

```powershell
qpdf --decrypt --password=F1N4NZ4S2025 archivo.pdf salida.pdf
```

### Cambiar contraseña

Edita `server.js` línea 19:

```javascript
const EDIT_PASSWORD = "TU_NUEVA_CONTRASEÑA";
```

## ⚙️ Configuración Avanzada

### Archivo de configuración

`config/_CONFIGURACION_UNICA.json`

### Agregar región con censura inteligente

```json
{
  "x": 100,
  "y": 50,
  "width": 40,
  "height": 20,
  "color": "#000000",
  "censorBold": true,
  "smartCensor": true
}
```

### Flags especiales:

- `censorBold`: Censura solo texto en negrita (negro)
- `smartCensor`: Censura solo en zonas predefinidas

## 📝 Notas Importantes

1. **qpdf es OPCIONAL**: Si no está instalado, los PDFs se procesan sin encriptación
2. **Nombres en MAYÚSCULAS**: Todos los archivos de salida se renombran automáticamente
3. **Persistencia**: La configuración sobrevive al reinicio del servidor
4. **Multi-cliente**: Todos los clientes usan la misma configuración del servidor

## 🆘 Solución de Problemas

### "qpdf no está disponible"

- Instala qpdf con el script `INSTALAR_QPDF.bat`
- O manualmente desde https://qpdf.sourceforge.io/

### "Puerto 3001 en uso"

```powershell
Stop-Process -Name node -Force
node server.js
```

### "No censura correctamente"

- Verifica coordenadas en `config/_CONFIGURACION_UNICA.json`
- Usa la interfaz de Configuración para ajustar regiones visualmente
