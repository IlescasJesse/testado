const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const { spawnSync } = require("child_process");
const tesseract = require("node-tesseract-ocr");
const poppler = require("pdf-poppler");
const { createCanvas, loadImage } = require("canvas");

const app = express();
const PORT = 3001;
const HOST = "0.0.0.0";

// Array para almacenar archivos procesados
let processedFiles = [];

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Configuración de directorios
const directories = [
  path.join(__dirname, "contratos"),
  path.join(__dirname, "tested_Censurado"),
  path.join(__dirname, "temp_uploads"),
  path.join(__dirname, "config"),
  path.join(__dirname, "build"),
];

directories.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configuración de Multer para cargar múltiples PDFs
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === ".pdf") {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos PDF"));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB por archivo
    files: 1000, // Máximo 1000 archivos
  },
});

// Función para detectar RFC usando OCR y testar en imagen
async function detectarYTestarRFCEnImagen(pdfBytes, pageIndex = 1) {
  let tempPdfPath = null;
  let imgPath = null;

  try {
    tempPdfPath = path.join(
      __dirname,
      "temp_uploads",
      `temp_${Date.now()}_${Math.random()}.pdf`
    );
    fs.writeFileSync(tempPdfPath, pdfBytes);

    const opts = {
      format: "png",
      out_dir: path.join(__dirname, "temp_uploads"),
      out_prefix: `ocr_${Date.now()}_${Math.random()}`,
      page: pageIndex + 1,
      scale: 2048,
    };

    await poppler.convert(tempPdfPath, opts);

    const outputName = `${opts.out_prefix}-${opts.page}.png`;
    imgPath = path.join(opts.out_dir, outputName);

    if (fs.existsSync(imgPath)) {
      const config = {
        lang: "spa",
        oem: 1,
        psm: 3,
      };

      const text = await tesseract.recognize(imgPath, config);

      const { execSync } = require("child_process");
      const tsvPath = imgPath.replace(".png", ".tsv");
      execSync(
        `tesseract "${imgPath}" "${tsvPath.replace(
          ".tsv",
          ""
        )}" -l spa --oem 1 --psm 3 tsv`,
        { encoding: "utf8" }
      );
      const tsv = fs.readFileSync(tsvPath, "utf8");

      const regex = /n[uú]mero\s*:?\s*([A-ZÑ&]{4}\d{6}[A-Z0-9]{3})/i;
      const match = text.match(regex);

      if (match && match[1]) {
        const rfc = match[1].replace(/[^A-Z0-9Ñ&]/g, "").toUpperCase();
        if (rfc.length === 13) {
          const image = await loadImage(imgPath);
          const canvas = createCanvas(image.width, image.height);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);

          const lines = tsv.split("\n");
          let rfcFound = false;
          let minX = Infinity,
            minY = Infinity,
            maxX = 0,
            maxY = 0;

          // Buscar RFC completo
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split("\t");
            if (cols.length < 12) continue;

            const rawText = cols[11]?.trim() || "";
            const text = rawText.toUpperCase().replace(/[^A-Z0-9]/g, "");
            const left = parseInt(cols[6]);
            const top = parseInt(cols[7]);
            const w = parseInt(cols[8]);
            const h = parseInt(cols[9]);

            if (!text || isNaN(left) || isNaN(top)) continue;

            if (text === rfc) {
              minX = left;
              minY = top;
              maxX = left + w;
              maxY = top + h;
              rfcFound = true;
              break;
            }
          }

          // Buscar fragmentos si no se encontró completo
          if (!rfcFound) {
            for (let i = 1; i < lines.length; i++) {
              const cols = lines[i].split("\t");
              if (cols.length < 12) continue;

              const rawText = cols[11]?.trim() || "";
              const text = rawText.toUpperCase().replace(/[^A-Z0-9]/g, "");
              const left = parseInt(cols[6]);
              const top = parseInt(cols[7]);
              const w = parseInt(cols[8]);
              const h = parseInt(cols[9]);

              if (!text || isNaN(left) || isNaN(top)) continue;

              if (text.length >= 8 && rfc.includes(text)) {
                minX = Math.min(minX, left);
                minY = Math.min(minY, top);
                maxX = Math.max(maxX, left + w);
                maxY = Math.max(maxY, top + h);
                rfcFound = true;
              }
            }
          }

          const { registerFont } = require("canvas");
          registerFont(
            path.join(__dirname, "fonts", "Montserrat-Regular.ttf"),
            { family: "Montserrat" }
          );

          let x, y, width, height;

          if (rfcFound && minX < Infinity) {
            x = minX;
            y = minY;
            width = maxX - minX;
            height = maxY - minY;
          } else {
            // Fallback: buscar "b)" y "número"
            let fallbackY = 690;
            let fallbackX = 970;

            for (let i = 1; i < lines.length; i++) {
              const cols = lines[i].split("\t");
              if (cols.length < 12) continue;
              const text = cols[11]?.trim().toLowerCase() || "";

              if (text.includes("b)")) {
                for (let j = i; j < Math.min(i + 20, lines.length); j++) {
                  const cols2 = lines[j].split("\t");
                  if (cols2.length < 12) continue;
                  const text2 = cols2[11]?.trim().toLowerCase() || "";

                  if (text2.includes("número") && !text2.includes("edificio")) {
                    fallbackY = parseInt(cols2[7]) || fallbackY;
                    fallbackX =
                      parseInt(cols2[6]) + parseInt(cols2[8]) + 50 || fallbackX;
                    break;
                  }
                }
                break;
              }
            }

            x = fallbackX - 10;
            y = fallbackY - 8;
            width = 240;
            height = 38;
          }

          // SIEMPRE dibujar rectángulo
          ctx.fillStyle = "#000000";
          ctx.fillRect(
            x,
            y,
            width + (rfcFound ? 25 : 0),
            height + (rfcFound ? 16 : 0)
          );

          ctx.fillStyle = "#FFFFFF";
          ctx.font = "bold 38px Montserrat";
          ctx.textAlign = "center";
          ctx.fillText("1. RFC", x + width / 2, y + height / 2 + 18);

          const testedImgPath = path.join(
            opts.out_dir,
            `tested_${Date.now()}_${Math.random()}.png`
          );
          const buffer = canvas.toBuffer("image/png");
          fs.writeFileSync(testedImgPath, buffer);

          if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
          if (fs.existsSync(tsvPath)) fs.unlinkSync(tsvPath);

          return { rfc, testedImagePath: testedImgPath };
        }
      }
    }

    return null;
  } catch (error) {
    console.log(`⚠ OCR Error: ${error.message}`);
    return null;
  } finally {
    if (tempPdfPath && fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
  }
}

// Función para censurar PDF
async function censorPdf(inputBytes, outputPath, filename) {
  const pdfDoc = await PDFDocument.load(inputBytes);
  const pages = pdfDoc.getPages();

  // Detectar RFC en página 2
  const rfcDetectado = await detectarYTestarRFCEnImagen(inputBytes, 1);

  if (
    rfcDetectado?.testedImagePath &&
    fs.existsSync(rfcDetectado.testedImagePath)
  ) {
    const page2 = pages[1];
    const { width, height } = page2.getSize();

    const imgBuffer = fs.readFileSync(rfcDetectado.testedImagePath);
    const pngImage = await pdfDoc.embedPng(imgBuffer);

    page2.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: width,
      height: height,
      opacity: 1.0,
    });

    fs.unlinkSync(rfcDetectado.testedImagePath);
  }

  // Redimensionar página 2 al 71% y agregar leyenda
  if (pages.length >= 2) {
    const page2 = pages[1];
    const { width, height } = page2.getSize();

    const escalaContrato = 0.71;
    page2.scaleContent(escalaContrato, escalaContrato);

    const scaledWidth = width * escalaContrato;
    const scaledHeight = height * escalaContrato;
    const offsetX = (width - scaledWidth) / 2;
    const offsetY = height - scaledHeight - 15;

    page2.translateContent(offsetX, offsetY);

    const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [1]);
    pdfDoc.removePage(1);
    pdfDoc.insertPage(1, copiedPage);

    const newPage2 = pdfDoc.getPages()[1];

    const leyendaTexto = [
      "VERSIÓN PÚBLICA DERIVADA DE LA OBLIGACIÓN ESTABLECIDA POR EL ARTÍCULO 65, FRACCIÓN X, MISMA QUE DICE A LA LETRA «…Las contrataciones de servicios profesionales por honorarios…»:",
      "CUYO DATO TESTADO ES REGISTRO FEDERAL DE CONTRIBUYENTES.",
      " 1.- RFC (una línea).",
      "",
      "De conformidad a: Ley General de Transparencia y Acceso a la Información Pública vigente, Artículo 103 La clasificación de la información se llevará a cabo en el momento en que:",
      "I. Se reciba una solicitud de acceso a la información; II. Se determine mediante resolución de autoridad competente, o III. Se generen versiones públicas para dar cumplimiento a las obligaciones",
      "de transparencia previstas en esta Ley. Artículo 115. Se considera información confidencial la que contiene datos personales concernientes a una persona física identificada o identificable.",
      "La información confidencial no estará sujeta a temporalidad alguna y sólo podrán tener acceso a ella los titulares de la misma, sus representantes y las personas servidoras públicas facultadas",
      "para ello. Asimismo, será información confidencial aquella que presenten las personas particulares a los sujetos obligados, siempre que tengan el derecho a ello, de conformidad con lo dispuesto",
      "por las leyes o los tratados internacionales. Ley General de Protección de Datos Personales en Posesión de Sujetos Obligados vigente, Artículo 3 Para los efectos de la presente Ley se entenderá",
      "por: fracción X Datos personales sensibles: Aquellos que se refieran a la esfera más íntima de su titular, o cuya utilización indebida pueda dar origen a discriminación o conlleve un riesgo grave",
      "para ésta. De manera enunciativa más no limitativa, se consideran sensibles los datos personales que puedan revelar aspectos como origen racial o étnico, estado de salud presente o futuro,",
      "información genética, creencias religiosas, filosóficas y morales, opiniones políticas y preferencia sexual. Ley de Transparencia y Acceso a la Información Pública con Sentido Social y Buen",
      "Gobierno del Estado de Oaxaca vigente, Artículo 3. Para los efectos de la presente Ley se entiende por: fracción VIII. Clasificación de la información: Acto por el cuál se determina que la información",
      "que posee el sujeto obligado es pública, reservada o confidencial, de acuerdo con lo establecido en los ordenamientos legales de la materia; fracción XXI. Información confidencial: La información en",
      "posesión de los sujetos obligados, que refiera a la vida privada y/o datos personales, por lo que no puede ser difundida, publicada o dada a conocer, excepto en aquellos casos en que así lo contemple",
      "la presente Ley y la Ley de la materia; Artículo 60, párrafo III. Aquella información particular de la referida en este Título que se ubique en alguno de los supuestos de clasificación señalados en los",
      "artículos 129 y 134 de la presente Ley, no será objeto de la publicación a que se refiere este mismo artículo, salvo que pueda ser elaborada una versión pública. En todo caso se aplicará la prueba de",
      "daño a que se refiere el artículo 107 de la Ley General y el correspondiente de la presente Ley; Artículo 70. Los sujetos obligados del Estado publicarán las obligaciones de transparencia comunes a",
      "las que se refiere el artículo 65 de la Ley General, debiendo ponerla a disposición del público y mantenerla actualizada en los respectivos medios electrónicos que corresponda al ámbito de su",
      "competencia, sin que medie solicitud de información o requerimiento alguno; Artículo 119. La clasificación de la información se llevará a cabo en el momento en que: Fracción III. Se generen versiones",
      "públicas para dar cumplimiento a las obligaciones de transparencia previstas en la Ley General y en esta Ley. Artículo 134. Se considera información confidencial la que se contiene datos personales",
      "concernientes a una persona física identificada o identificable.",
    ];

    const montserratBytes = fs.readFileSync(
      path.join(__dirname, "fonts", "Montserrat-Regular.ttf")
    );
    pdfDoc.registerFontkit(fontkit);
    const montserratFont = await pdfDoc.embedFont(montserratBytes);

    const fontSize = 5.5;
    const lineHeight = 6.5;
    const margin = 15;
    const textWidth = width - margin * 2;
    const leyendaHeight = leyendaTexto.length * lineHeight + margin * 2;
    const leyendaY = 10;

    newPage2.drawRectangle({
      x: margin - 5,
      y: leyendaY,
      width: textWidth + 10,
      height: leyendaHeight,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.5,
    });

    function drawJustifiedText(text, x, y, maxWidth, font, size) {
      if (!text || text.trim() === "") return;

      const words = text.trim().split(/\s+/);
      if (words.length === 1) {
        newPage2.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
        return;
      }

      let totalWordWidth = 0;
      words.forEach((word) => {
        totalWordWidth += font.widthOfTextAtSize(word, size);
      });

      const totalSpaceWidth = maxWidth - totalWordWidth;
      const spaceWidth = totalSpaceWidth / (words.length - 1);

      let currentX = x;
      words.forEach((word) => {
        newPage2.drawText(word, {
          x: currentX,
          y,
          size,
          font,
          color: rgb(0, 0, 0),
        });
        const wordWidth = font.widthOfTextAtSize(word, size);
        currentX += wordWidth + spaceWidth;
      });
    }

    leyendaTexto.forEach((linea, index) => {
      const yPos =
        leyendaY + leyendaHeight - (margin + index * lineHeight) - fontSize;
      const noJustificar = [1, 2, 3, leyendaTexto.length - 1];

      if (noJustificar.includes(index) || !linea.trim()) {
        newPage2.drawText(linea, {
          x: margin,
          y: yPos,
          size: fontSize,
          font: montserratFont,
          color: rgb(0, 0, 0),
        });
      } else {
        drawJustifiedText(
          linea,
          margin,
          yPos,
          textWidth,
          montserratFont,
          fontSize
        );
      }
    });
  }

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);

  // Encriptar con qpdf si está disponible
  try {
    const r = spawnSync("qpdf", ["--version"], { stdio: "pipe" });
    if (r.status === 0) {
      const tmpPath = `${outputPath}.enc`;
      const args = [
        "--encrypt",
        "",
        "F1N4NZ4S2025",
        "256",
        "--modify=none",
        "--print=full",
        "--",
        outputPath,
        tmpPath,
      ];
      const res = spawnSync("qpdf", args, { stdio: "pipe" });
      if (res.status === 0) {
        fs.renameSync(tmpPath, outputPath);
      }
    }
  } catch (err) {
    // Ignorar si qpdf no está disponible
  }

  // Renombrar a mayúsculas
  const dir = path.dirname(outputPath);
  const basename = path.basename(outputPath);
  const uppercaseFilename = basename.toUpperCase();

  if (basename !== uppercaseFilename) {
    const newPath = path.join(dir, uppercaseFilename);
    fs.renameSync(outputPath, newPath);
    return uppercaseFilename;
  }

  return basename;
}

// RUTAS

// Ruta principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Ruta para procesar múltiples PDFs
app.post("/api/process", upload.array("pdfs", 1000), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No se recibieron archivos",
      });
    }

    const totalFiles = req.files.length;

    // Responder inmediatamente
    res.json({
      success: true,
      message: `Procesando ${totalFiles} archivos en segundo plano...`,
      totalFiles: totalFiles,
      processing: true,
      timestamp: new Date().toISOString(),
    });

    // Procesar en segundo plano
    setImmediate(async () => {
      const startTime = Date.now();
      const outputDir = path.join(__dirname, "tested_Censurado");

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const startFileTime = Date.now();

        try {
          const outputPath = path.join(outputDir, file.originalname);
          const finalFilename = await censorPdf(
            file.buffer,
            outputPath,
            file.originalname
          );

          const fileData = {
            id: Date.now() + Math.random() + i,
            filename: file.originalname,
            finalFilename: finalFilename,
            size: file.size,
            uploadDate: new Date().toISOString(),
            processingTime: Date.now() - startFileTime,
            success: true,
          };

          processedFiles.push(fileData);
          console.log(
            `✅ [${i + 1}/${totalFiles}] ${finalFilename} (${
              Date.now() - startFileTime
            }ms)`
          );
        } catch (error) {
          // Guardar archivo con error para reprocesar
          const errorDir = path.join(__dirname, "temp_uploads", "errors");
          if (!fs.existsSync(errorDir)) {
            fs.mkdirSync(errorDir, { recursive: true });
          }
          const errorPath = path.join(errorDir, file.originalname);
          fs.writeFileSync(errorPath, file.buffer);

          const fileData = {
            id: Date.now() + Math.random() + i,
            filename: file.originalname,
            size: file.size,
            uploadDate: new Date().toISOString(),
            processingTime: Date.now() - startFileTime,
            success: false,
            error: error.message,
          };

          processedFiles.push(fileData);
          console.log(
            `❌ [${i + 1}/${totalFiles}] ${file.originalname}: ${error.message}`
          );
        }
      }

      const successCount = processedFiles.filter((f) => f.success).length;
      const totalTime = Date.now() - startTime;

      console.log(
        `\n🎉 Completado: ${successCount}/${totalFiles} archivos en ${(
          totalTime / 1000
        ).toFixed(2)}s\n`
      );
    });
  } catch (error) {
    console.error("Error al procesar archivos:", error);
    res.status(500).json({
      success: false,
      message: "Error al procesar los archivos",
      error: error.message,
    });
  }
});

// Ruta para obtener archivos procesados
app.get("/api/get-files", (req, res) => {
  res.json({
    success: true,
    files: processedFiles,
    total: processedFiles.length,
    timestamp: new Date().toISOString(),
  });
});

// Ruta para limpiar archivos procesados
app.post("/api/clear-files", (req, res) => {
  try {
    const outputDir = path.join(__dirname, "tested_Censurado");

    // Eliminar archivos físicos
    if (fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir);
      files.forEach((file) => {
        const filePath = path.join(outputDir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      });
    }

    // Limpiar lista en memoria
    processedFiles = [];

    res.json({
      success: true,
      message: "Archivos limpiados correctamente",
    });
  } catch (error) {
    console.error("Error al limpiar archivos:", error);
    res.status(500).json({
      success: false,
      message: "Error al limpiar los archivos",
      error: error.message,
    });
  }
});

// Ruta para reprocesar archivos con error
app.post("/api/retry-errors", async (req, res) => {
  try {
    const errorDir = path.join(__dirname, "temp_uploads", "errors");

    if (!fs.existsSync(errorDir)) {
      return res.json({
        success: true,
        message: "No hay archivos con error para reprocesar",
        totalFiles: 0,
      });
    }

    const errorFiles = fs
      .readdirSync(errorDir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"));

    if (errorFiles.length === 0) {
      return res.json({
        success: true,
        message: "No hay archivos con error para reprocesar",
        totalFiles: 0,
      });
    }

    const totalFiles = errorFiles.length;

    // Responder inmediatamente
    res.json({
      success: true,
      message: `Reprocesando ${totalFiles} archivos con error...`,
      totalFiles: totalFiles,
      processing: true,
      timestamp: new Date().toISOString(),
    });

    // Limpiar archivos procesados anteriormente con error
    processedFiles = processedFiles.filter((f) => f.success);

    // Procesar en segundo plano
    setImmediate(async () => {
      const startTime = Date.now();
      const outputDir = path.join(__dirname, "tested_Censurado");

      for (let i = 0; i < errorFiles.length; i++) {
        const filename = errorFiles[i];
        const errorPath = path.join(errorDir, filename);
        const startFileTime = Date.now();

        try {
          const fileBuffer = fs.readFileSync(errorPath);
          const outputPath = path.join(outputDir, filename);
          const finalFilename = await censorPdf(
            fileBuffer,
            outputPath,
            filename
          );

          const fileData = {
            id: Date.now() + Math.random() + i,
            filename: filename,
            finalFilename: finalFilename,
            size: fileBuffer.length,
            uploadDate: new Date().toISOString(),
            processingTime: Date.now() - startFileTime,
            success: true,
          };

          processedFiles.push(fileData);

          // Eliminar archivo de carpeta de errores
          fs.unlinkSync(errorPath);

          console.log(
            `✅ [${i + 1}/${totalFiles}] ${finalFilename} (${
              Date.now() - startFileTime
            }ms)`
          );
        } catch (error) {
          const fileData = {
            id: Date.now() + Math.random() + i,
            filename: filename,
            size: 0,
            uploadDate: new Date().toISOString(),
            processingTime: Date.now() - startFileTime,
            success: false,
            error: error.message,
          };

          processedFiles.push(fileData);
          console.log(
            `❌ [${i + 1}/${totalFiles}] ${filename}: ${error.message}`
          );
        }
      }

      const successCount = processedFiles.filter((f) => f.success).length;
      const totalTime = Date.now() - startTime;

      console.log(
        `\n🎉 Reprocesado: ${successCount}/${totalFiles} archivos en ${(
          totalTime / 1000
        ).toFixed(2)}s\n`
      );
    });
  } catch (error) {
    console.error("Error al reprocesar archivos:", error);
    res.status(500).json({
      success: false,
      message: "Error al reprocesar archivos",
      error: error.message,
    });
  }
});

// Ruta para descargar ZIP con los PDFs testados
app.get("/api/download-zip", (req, res) => {
  const archiver = require("archiver");
  const archive = archiver("zip", { zlib: { level: 9 } });

  res.attachment("testados.zip");
  archive.pipe(res);

  const outputDir = path.join(__dirname, "tested_Censurado");
  const files = processedFiles.filter((f) => f.success);

  files.forEach((fileData) => {
    const filePath = path.join(
      outputDir,
      fileData.finalFilename || fileData.filename
    );
    if (fs.existsSync(filePath)) {
      archive.file(filePath, {
        name: fileData.finalFilename || fileData.filename,
      });
    }
  });

  // Agregar log de errores
  const errorLog = processedFiles
    .filter((f) => !f.success)
    .map((f) => `${f.filename}: ${f.error}`)
    .join("\n");

  if (errorLog) {
    archive.append(errorLog, { name: "errores.txt" });
  }

  archive.finalize();
});

// Iniciar servidor
app.listen(PORT, HOST, () => {
  const os = require("os");
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  console.log("\n🚀 Servidor iniciado");
  console.log(`   Local:   http://localhost:${PORT}`);
  addresses.forEach((addr) => {
    console.log(`   Red:     http://${addr}:${PORT}`);
  });
  console.log("\n📁 Límite: 1000 archivos PDF");
  console.log("💾 Tamaño máximo: 50MB por archivo\n");
});
