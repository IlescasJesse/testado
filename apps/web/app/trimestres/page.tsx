"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ArchiveIcon from "@mui/icons-material/Archive";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  apiGet,
  apiPost,
  urlRespaldo,
} from "@/lib/api";
import type { ContratoDTO, ResumenTrimestre, ResumenDesbloqueo } from "@/lib/api";

const periodoLabel = (p: number): string =>
  (["", "Enero–Marzo", "Abril–Junio", "Julio–Septiembre", "Octubre–Diciembre"] as const)[p] ??
  p.toString();

interface DialogState {
  open: boolean;
  anio: number;
  periodo: number;
}

export default function TrimestresPage() {
  const [trimestres, setTrimestres] = useState<ResumenTrimestre[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const [dialogContratos, setDialogContratos] = useState<ContratoDTO[]>([]);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogPassword, setDialogPassword] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [dialogSuccess, setDialogSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const cargarTrimestres = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ trimestres: ResumenTrimestre[] }>("/api/trimestres");
      setTrimestres(data.trimestres);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar trimestres");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarTrimestres();
  }, [cargarTrimestres]);

  const handleAbrirDialog = useCallback(
    async (anio: number, periodo: number) => {
      // Reset all dialog state
      setDialogContratos([]);
      setDialogError(null);
      setDialogPassword("");
      setSelectedIds([]);
      setDialogSuccess(null);
      setDialogLoading(true);
      setDialogState({ open: true, anio, periodo });

      try {
        const data = await apiGet<{ contratos: ContratoDTO[] }>(
          `/api/contratos?anio=${anio}&periodo=${periodo}`
        );
        const bloqueados = data.contratos.filter((c) => c.estado === "BLOQUEADO");
        setDialogContratos(bloqueados);
        setSelectedIds(bloqueados.map((c) => c.id));
      } catch (err) {
        setDialogError(
          err instanceof Error ? err.message : "Error al cargar contratos"
        );
      } finally {
        setDialogLoading(false);
      }
    },
    []
  );

  const handleCerrarDialog = () => {
    setDialogState(null);
  };

  const handleToggleId = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleDesbloquear = async () => {
    if (!dialogState || selectedIds.length === 0) return;
    setSubmitting(true);
    setDialogError(null);
    setDialogSuccess(null);

    try {
      const result = await apiPost<ResumenDesbloqueo | { success: false; message?: string }>(
        "/api/contratos/desbloquear",
        { ids: selectedIds, password: dialogPassword }
      );

      if (result.status === 401) {
        setDialogError("Contraseña incorrecta");
      } else {
        const resumen = result.data as ResumenDesbloqueo;
        const count = resumen.desbloqueados ?? selectedIds.length;
        setDialogSuccess(`${count} contratos desbloqueados correctamente`);
        setTimeout(() => {
          setDialogState(null);
          cargarTrimestres();
        }, 2000);
      }
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Error al desbloquear");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto", p: 3 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        <CalendarMonthIcon color="primary" sx={{ fontSize: 32 }} />
        <Typography variant="h4" fontWeight={700}>
          Trimestres y Respaldos
        </Typography>
      </Box>

      {/* Loading */}
      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Error */}
      {error && !loading && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<RefreshIcon />}
              onClick={cargarTrimestres}
            >
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* Empty state */}
      {!loading && !error && trimestres.length === 0 && (
        <Typography
          color="text.secondary"
          sx={{ textAlign: "center", py: 8 }}
        >
          No hay trimestres registrados.
        </Typography>
      )}

      {/* Cards grid */}
      {!loading && trimestres.length > 0 && (
        <Grid container spacing={3}>
          {trimestres.map((t) => (
            <Grid
              key={`${t.anio}-${t.periodo}`}
              size={{ xs: 12, sm: 6, md: 4 }}
            >
              <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                <CardContent sx={{ flex: 1 }}>
                  {/* Card title */}
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                    <CalendarMonthIcon color="action" />
                    <Typography variant="h6" fontWeight={600}>
                      Trimestre {t.periodo} — {t.anio}
                    </Typography>
                  </Box>

                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mb: 2 }}
                  >
                    {periodoLabel(t.periodo)}
                  </Typography>

                  {/* Stats */}
                  <List dense disablePadding>
                    <ListItem disableGutters>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <CalendarMonthIcon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText
                        primary={`${t.total} contratos en total`}
                      />
                    </ListItem>

                    <ListItem disableGutters>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <CheckCircleIcon fontSize="small" color="success" />
                      </ListItemIcon>
                      <ListItemText primary={`${t.testados} testados`} />
                    </ListItem>

                    <ListItem disableGutters>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <LockIcon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText primary={`${t.bloqueados} bloqueados`} />
                    </ListItem>

                    <ListItem disableGutters>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <LockOpenIcon fontSize="small" color="primary" />
                      </ListItemIcon>
                      <ListItemText primary={`${t.desbloqueados} desbloqueados`} />
                    </ListItem>

                    {t.errores > 0 && (
                      <ListItem disableGutters>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <ErrorOutlineIcon fontSize="small" color="error" />
                        </ListItemIcon>
                        <ListItemText
                          primary={`${t.errores} errores`}
                          primaryTypographyProps={{ color: "error" }}
                        />
                      </ListItem>
                    )}
                  </List>
                </CardContent>

                <CardActions sx={{ px: 2, pb: 2, gap: 1, flexWrap: "wrap" }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ArchiveIcon />}
                    onClick={() => window.open(urlRespaldo(t.anio, t.periodo), "_blank")}
                  >
                    Descargar respaldo
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<LockOpenIcon />}
                    disabled={t.bloqueados === 0}
                    onClick={() => handleAbrirDialog(t.anio, t.periodo)}
                  >
                    Desbloquear
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Desbloquear Dialog */}
      <Dialog
        open={dialogState?.open ?? false}
        onClose={handleCerrarDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <LockOpenIcon color="primary" />
          {dialogState
            ? `Desbloquear contratos — Trimestre ${dialogState.periodo} ${dialogState.anio}`
            : "Desbloquear contratos"}
        </DialogTitle>

        <DialogContent dividers>
          {/* Dialog loading */}
          {dialogLoading && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={28} />
              <Typography sx={{ ml: 2 }}>Cargando contratos...</Typography>
            </Box>
          )}

          {/* Dialog error (load) */}
          {dialogError && !dialogSuccess && !submitting && dialogContratos.length === 0 && !dialogLoading && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {dialogError}
            </Alert>
          )}

          {/* Contract list */}
          {!dialogLoading && (
            <>
              {dialogContratos.length === 0 && !dialogError ? (
                <Typography color="text.secondary" sx={{ py: 2 }}>
                  No hay contratos bloqueados en este trimestre.
                </Typography>
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Selecciona los contratos a desbloquear:
                  </Typography>
                  <List dense>
                    {dialogContratos.map((c) => (
                      <ListItem
                        key={c.id}
                        disableGutters
                        sx={{ borderBottom: "1px solid", borderColor: "divider" }}
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <Checkbox
                            edge="start"
                            checked={selectedIds.includes(c.id)}
                            onChange={() => handleToggleId(c.id)}
                            size="small"
                          />
                        </ListItemIcon>
                        <ListItemText
                          primary={`${c.rfc} — ${c.nombre ?? "Sin nombre"}`}
                          secondary={c.nombreArchivo}
                        />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}

              {/* Password field */}
              {dialogContratos.length > 0 && (
                <TextField
                  type="password"
                  label="Contraseña de desbloqueo"
                  value={dialogPassword}
                  onChange={(e) => setDialogPassword(e.target.value)}
                  required
                  fullWidth
                  sx={{ mt: 2 }}
                  disabled={submitting}
                />
              )}

              {/* Inline alerts */}
              {dialogError && !dialogLoading && dialogContratos.length > 0 && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {dialogError}
                </Alert>
              )}
              {dialogSuccess && (
                <Alert severity="success" sx={{ mt: 2 }}>
                  {dialogSuccess}
                </Alert>
              )}
            </>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={handleCerrarDialog} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            startIcon={<LockOpenIcon />}
            onClick={handleDesbloquear}
            disabled={
              submitting ||
              dialogLoading ||
              selectedIds.length === 0 ||
              !dialogPassword ||
              !!dialogSuccess
            }
          >
            {submitting ? "Desbloqueando..." : "Desbloquear seleccionados"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
