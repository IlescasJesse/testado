"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Alert,
  LinearProgress,
  MenuItem,
  Select,
  TextField,
  Typography,
  Chip,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DocumentScannerIcon from "@mui/icons-material/DocumentScanner";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import RefreshIcon from "@mui/icons-material/Refresh";
import { apiGet, apiUpload } from "@/lib/api";
import type { LoteIniciado, ProgresoLote, ResultadoProcesar } from "@/lib/api";

type ResolucionDuplicado = "omitir" | "reemplazar" | "version";

type AppState = "idle" | "uploading" | "polling" | "done";

export default function HomePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [anio, setAnio] = useState<string>(String(new Date().getFullYear()));
  const [periodo, setPeriodo] = useState<string>("");
  const [appState, setAppState] = useState<AppState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<ProgresoLote | null>(null);
  const [resultados, setResultados] = useState<ResultadoProcesar[]>([]);
  const [showDuplicadosDialog, setShowDuplicadosDialog] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentFilesRef = useRef<File[]>([]);
  const currentAnioRef = useRef<string>("");
  const currentPeriodoRef = useRef<string>("");

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const startPolling = useCallback(
    (loteId: string) => {
      stopPolling();

      const poll = async () => {
        try {
          const data = await apiGet<ProgresoLote>(
            `/api/contratos/progreso?loteId=${encodeURIComponent(loteId)}`
          );
          setProgreso(data);
          setResultados(data.hechos);

          if (data.completado) {
            stopPolling();
            setAppState("done");
            const hasDuplicados = data.hechos.some(
              (r) => r.estado === "duplicado"
            );
            if (hasDuplicados) {
              setShowDuplicadosDialog(true);
            }
          }
        } catch (err) {
          stopPolling();
          setError(
            err instanceof Error ? err.message : "Error al obtener progreso"
          );
          setAppState("idle");
        }
      };

      // Sin timeout: el lote sigue procesándose en el servidor pase lo que
      // pase con el cliente, así que seguimos consultando hasta "completado".
      intervalRef.current = setInterval(poll, 1500);

      // Run immediately
      poll();
    },
    [stopPolling]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const arr = Array.from(e.target.files);
      setFiles(arr);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf")
    );
    if (dropped.length > 0) {
      setFiles(dropped);
    }
  };

  const handleSubmit = async (
    filesToUpload: File[],
    anioVal: string,
    periodoVal: string,
    resolucion?: ResolucionDuplicado
  ) => {
    setError(null);
    setAppState("uploading");
    setResultados([]);
    setProgreso(null);

    const fd = new FormData();
    for (const f of filesToUpload) {
      fd.append("pdfs", f);
    }
    if (anioVal.trim() !== "") {
      fd.append("anio", anioVal.trim());
    }
    if (periodoVal !== "") {
      fd.append("periodo", periodoVal);
    }
    if (resolucion) {
      fd.append("resolucionDuplicado", resolucion);
    }

    try {
      const lote = await apiUpload<LoteIniciado>("/api/contratos/testar", fd);
      setAppState("polling");
      startPolling(lote.loteId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al subir los archivos"
      );
      setAppState("idle");
    }
  };

  const handleTestar = () => {
    currentFilesRef.current = files;
    currentAnioRef.current = anio;
    currentPeriodoRef.current = periodo;
    handleSubmit(files, anio, periodo);
  };

  const handleResolucionDuplicado = (res: ResolucionDuplicado) => {
    setShowDuplicadosDialog(false);
    setAppState("uploading");
    handleSubmit(
      currentFilesRef.current,
      currentAnioRef.current,
      currentPeriodoRef.current,
      res
    );
  };

  const handleReset = () => {
    stopPolling();
    setFiles([]);
    setAnio(String(new Date().getFullYear()));
    setPeriodo("");
    setAppState("idle");
    setError(null);
    setProgreso(null);
    setResultados([]);
    setShowDuplicadosDialog(false);
    currentFilesRef.current = [];
    currentAnioRef.current = "";
    currentPeriodoRef.current = "";
  };

  const isProcessing = appState === "uploading" || appState === "polling";
  const isDone = appState === "done" && !showDuplicadosDialog;

  const countByEstado = (estado: ResultadoProcesar["estado"]) =>
    resultados.filter((r) => r.estado === estado).length;

  const duplicados = resultados.filter((r) => r.estado === "duplicado");
  const errores = resultados.filter((r) => r.estado === "error");

  const porcentaje =
    progreso && progreso.total > 0
      ? Math.round((progreso.hechos.length / progreso.total) * 100)
      : 0;

  return (
    <Box sx={{ maxWidth: 800, mx: "auto", p: 3 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Subir &amp; Testar Contratos
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Drop zone */}
      {appState === "idle" && (
        <>
          <Box
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            sx={{
              border: "2px dashed",
              borderColor: isDragOver ? "primary.main" : "divider",
              borderRadius: 2,
              p: 5,
              textAlign: "center",
              cursor: "pointer",
              bgcolor: isDragOver ? "action.hover" : "background.paper",
              transition: "all 0.2s",
              mb: 2,
            }}
          >
            <CloudUploadIcon sx={{ fontSize: 64, color: "primary.main", mb: 1 }} />
            <Typography variant="h6" color="text.secondary">
              Arrastra PDFs aquí o haz clic para seleccionar
            </Typography>
            <input
              type="file"
              accept=".pdf"
              multiple
              ref={inputRef}
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </Box>

          {files.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Archivos seleccionados ({files.length}):
              </Typography>
              <List dense>
                {files.map((f, i) => (
                  <ListItem key={i} disableGutters>
                    <ListItemText primary={f.name} secondary={`${(f.size / 1024).toFixed(1)} KB`} />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}

          {/* Trimestre selector */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Ejercicio (Año)"
                placeholder="Año (ej. 2025)"
                type="number"
                value={anio}
                onChange={(e) => setAnio(e.target.value)}
                fullWidth
                inputProps={{ min: 2000, max: 2099 }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Select
                value={periodo}
                onChange={(e: SelectChangeEvent) => setPeriodo(e.target.value)}
                displayEmpty
                fullWidth
              >
                <MenuItem value="">Detectar automáticamente</MenuItem>
                <MenuItem value="1">T1 – Enero a Marzo</MenuItem>
                <MenuItem value="2">T2 – Abril a Junio</MenuItem>
                <MenuItem value="3">T3 – Julio a Septiembre</MenuItem>
                <MenuItem value="4">T4 – Octubre a Noviembre</MenuItem>
                <MenuItem value="5">T5 – Diciembre</MenuItem>
              </Select>
            </Grid>
          </Grid>

          <Button
            variant="contained"
            size="large"
            fullWidth
            startIcon={<DocumentScannerIcon />}
            disabled={files.length === 0 || isProcessing}
            onClick={handleTestar}
          >
            Testar
          </Button>
        </>
      )}

      {/* Polling / progress */}
      {(appState === "uploading" || appState === "polling") && (
        <Box sx={{ mt: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <AutorenewIcon
              sx={{
                animation: "spin 1s linear infinite",
                "@keyframes spin": {
                  "0%": { transform: "rotate(0deg)" },
                  "100%": { transform: "rotate(360deg)" },
                },
                color: "primary.main",
              }}
            />
            <Typography variant="body1">
              {appState === "uploading"
                ? "Subiendo archivos..."
                : `Procesando ${progreso?.hechos.length ?? 0} / ${progreso?.total ?? "?"} archivos...`}
            </Typography>
          </Box>
          {progreso && (
            <LinearProgress
              variant="determinate"
              value={porcentaje}
              sx={{ height: 8, borderRadius: 4, mb: 2 }}
            />
          )}
          {resultados.length > 0 && (
            <List dense>
              {resultados.map((r, i) => (
                <ResultadoRow key={i} resultado={r} />
              ))}
            </List>
          )}
        </Box>
      )}

      {/* Done + no pending dialog */}
      {isDone && (
        <Box sx={{ mt: 2 }}>
          {resultados.length > 0 && (
            <List dense sx={{ mb: 2 }}>
              {resultados.map((r, i) => (
                <ResultadoRow key={i} resultado={r} />
              ))}
            </List>
          )}
          <Divider sx={{ mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            Resumen
          </Typography>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <ResumenCard
                label="Testados"
                count={countByEstado("testado")}
                icon={<CheckCircleIcon color="success" />}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <ResumenCard
                label="Duplicados"
                count={countByEstado("duplicado")}
                icon={<ContentCopyIcon color="warning" />}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <ResumenCard
                label="Caché"
                count={countByEstado("cache")}
                icon={<CheckCircleIcon sx={{ color: "text.secondary" }} />}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <ResumenCard
                label="Errores"
                count={countByEstado("error")}
                icon={<ErrorOutlineIcon color="error" />}
              />
            </Grid>
          </Grid>

          {errores.length > 0 && (
            <Alert severity="error" sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Detalles de errores:
              </Typography>
              <List dense disablePadding>
                {errores.map((e, i) => (
                  <ListItem key={i} disableGutters>
                    <ListItemText
                      primary={e.rfc ?? e.nombre ?? `Archivo ${i + 1}`}
                      secondary={e.mensaje}
                    />
                  </ListItem>
                ))}
              </List>
            </Alert>
          )}

          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={handleReset}
          >
            Testar más contratos
          </Button>
        </Box>
      )}

      {/* Duplicados dialog */}
      <Dialog
        open={showDuplicadosDialog}
        onClose={handleReset}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ContentCopyIcon color="warning" />
          Contratos duplicados detectados
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Los siguientes contratos ya existen en el sistema:
          </Typography>
          <List dense>
            {duplicados.map((d, i) => (
              <ListItem key={i}>
                <ListItemText
                  primary={d.rfc ?? `Contrato ${i + 1}`}
                  secondary={d.nombre}
                />
              </ListItem>
            ))}
          </List>
          <Typography variant="body2" sx={{ mt: 1 }}>
            ¿Cómo deseas manejar los duplicados?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ flexDirection: "column", gap: 1, p: 2, alignItems: "stretch" }}>
          <Button
            variant="text"
            color="inherit"
            onClick={handleReset}
            fullWidth
          >
            Cancelar
          </Button>
          <Button
            variant="outlined"
            onClick={() => handleResolucionDuplicado("omitir")}
            fullWidth
          >
            Omitir duplicados
          </Button>
          <Button
            variant="outlined"
            color="warning"
            onClick={() => handleResolucionDuplicado("reemplazar")}
            fullWidth
          >
            Reemplazar
          </Button>
          <Button
            variant="contained"
            onClick={() => handleResolucionDuplicado("version")}
            fullWidth
          >
            Nueva versión
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function ResultadoRow({ resultado }: { resultado: ResultadoProcesar }) {
  const { estado, rfc, nombre, trimestre, mensaje } = resultado;

  const iconMap: Record<ResultadoProcesar["estado"], React.ReactNode> = {
    testado: <CheckCircleIcon color="success" fontSize="small" />,
    duplicado: <ContentCopyIcon color="warning" fontSize="small" />,
    cache: <CheckCircleIcon sx={{ color: "text.secondary" }} fontSize="small" />,
    error: <ErrorOutlineIcon color="error" fontSize="small" />,
  };

  const labelMap: Record<ResultadoProcesar["estado"], string> = {
    testado: "Testado",
    duplicado: "Duplicado",
    cache: "Caché",
    error: "Error",
  };

  const colorMap: Record<
    ResultadoProcesar["estado"],
    "success" | "warning" | "default" | "error"
  > = {
    testado: "success",
    duplicado: "warning",
    cache: "default",
    error: "error",
  };

  const secondary = [
    trimestre ? `T${trimestre.periodo} ${trimestre.anio}` : null,
    mensaje ?? null,
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <ListItem disableGutters>
      <ListItemIcon sx={{ minWidth: 32 }}>{iconMap[estado]}</ListItemIcon>
      <ListItemText
        primary={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" component="span">
              {rfc ?? nombre ?? "—"}
            </Typography>
            {nombre && rfc && (
              <Typography variant="body2" color="text.secondary" component="span">
                {nombre}
              </Typography>
            )}
            <Chip
              label={labelMap[estado]}
              color={colorMap[estado]}
              size="small"
            />
          </Box>
        }
        secondary={secondary || undefined}
      />
    </ListItem>
  );
}

function ResumenCard({
  label,
  count,
  icon,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
}) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ textAlign: "center", p: 2, "&:last-child": { pb: 2 } }}>
        {icon}
        <Typography variant="h4" fontWeight={700}>
          {count}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      </CardContent>
    </Card>
  );
}
