"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tab,
  Typography,
  Badge,
} from "@mui/material";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import ListAltIcon from "@mui/icons-material/ListAlt";
import { apiGet, apiPost } from "@/lib/api";
import type { ContratoDTO, Estado, ResumenBloqueo } from "@/lib/api";

type TabIndex = 0 | 1 | 2 | 3;

const TAB_ESTADOS: Array<Estado | null> = [null, "TESTADO", "BLOQUEADO", "DESBLOQUEADO"];

function formatFecha(iso: string): string {
  try {
    const d = new Date(iso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

function EstadoChip({ estado }: { estado: Estado }) {
  if (estado === "TESTADO") {
    return <Chip icon={<CheckCircleIcon />} label="Testado" color="success" size="small" />;
  }
  if (estado === "BLOQUEADO") {
    return <Chip icon={<LockIcon />} label="Bloqueado" color="default" size="small" />;
  }
  if (estado === "DESBLOQUEADO") {
    return <Chip icon={<LockOpenIcon />} label="Desbloqueado" color="primary" size="small" />;
  }
  return <Chip icon={<ErrorOutlineIcon />} label="Error" color="error" size="small" />;
}

export default function BloquearPage() {
  const [tab, setTab] = useState<TabIndex>(0);
  const [contratos, setContratos] = useState<ContratoDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set<number>());
  const [bloqueandoError, setBloqueandoError] = useState<string | null>(null);
  const [bloqueandoSuccess, setBloqueandoSuccess] = useState<string | null>(null);
  const [bloqueando, setBloqueando] = useState(false);

  const loadContratos = useCallback(async (tabIdx: TabIndex) => {
    setLoading(true);
    setLoadError(null);
    try {
      const estado = TAB_ESTADOS[tabIdx];
      const path = estado ? `/api/contratos?estado=${estado}` : "/api/contratos";
      const data = await apiGet<ContratoDTO[]>(path);
      setContratos(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error al cargar contratos");
      setContratos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelected(new Set<number>());
    setBloqueandoError(null);
    setBloqueandoSuccess(null);
    loadContratos(tab);
  }, [tab, loadContratos]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTab(newValue as TabIndex);
  };

  const testadosIds = contratos
    .filter((c) => c.estado === "TESTADO")
    .map((c) => c.id);

  const allTestadosSelected =
    testadosIds.length > 0 && testadosIds.every((id) => selected.has(id));
  const someTestadosSelected =
    testadosIds.some((id) => selected.has(id)) && !allTestadosSelected;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelected(new Set<number>(testadosIds));
    } else {
      setSelected(new Set<number>());
    }
  };

  const handleSelectRow = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set<number>(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleEliminar = async (id: number) => {
    try {
      await apiPost<{ success: boolean }>(`/api/contratos/${id}/eliminar`, {});
      setSelected((prev) => {
        const next = new Set<number>(prev);
        next.delete(id);
        return next;
      });
      await loadContratos(tab);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error al eliminar contrato");
    }
  };

  const handleBloquear = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    setBloqueando(true);
    setBloqueandoError(null);
    setBloqueandoSuccess(null);

    try {
      const result = await apiPost<ResumenBloqueo | { success: false; message: string }>(
        "/api/contratos/bloquear",
        { ids }
      );

      if (result.status === 409) {
        const errData = result.data as { success: false; message: string };
        setBloqueandoError(
          errData.message ??
            "qpdf no disponible en este servidor. No es posible bloquear contratos sin qpdf instalado."
        );
      } else {
        const resumen = result.data as ResumenBloqueo;
        setBloqueandoSuccess(`Bloqueados: ${resumen.bloqueados} contratos`);
        setSelected(new Set<number>());
        await loadContratos(tab);
      }
    } catch (err) {
      setBloqueandoError(err instanceof Error ? err.message : "Error al bloquear contratos");
    } finally {
      setBloqueando(false);
    }
  };

  const testadosCount = contratos.filter((c) => c.estado === "TESTADO").length;

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto", p: 3 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Bloquear Contratos
      </Typography>

      {/* Tabs */}
      <Tabs value={tab} onChange={handleTabChange} sx={{ mb: 2 }}>
        <Tab icon={<ListAltIcon />} iconPosition="start" label="Todos" />
        <Tab
          icon={<CheckCircleIcon />}
          iconPosition="start"
          label={
            <Badge badgeContent={testadosCount} color="success" max={999}>
              <Box sx={{ pr: testadosCount > 0 ? 2 : 0 }}>Testados</Box>
            </Badge>
          }
        />
        <Tab icon={<LockIcon />} iconPosition="start" label="Bloqueados" />
        <Tab icon={<LockOpenIcon />} iconPosition="start" label="Desbloqueados" />
      </Tabs>

      {/* Alerts */}
      {bloqueandoError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setBloqueandoError(null)}>
          {bloqueandoError}
        </Alert>
      )}
      {bloqueandoSuccess && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setBloqueandoSuccess(null)}>
          {bloqueandoSuccess}
        </Alert>
      )}
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLoadError(null)}>
          {loadError}
        </Alert>
      )}

      {/* Action bar */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {selected.size} seleccionados
        </Typography>
        <Button
          variant="contained"
          startIcon={<LockIcon />}
          disabled={selected.size === 0 || bloqueando}
          onClick={handleBloquear}
        >
          {bloqueando ? "Bloqueando..." : "Bloquear seleccionados"}
        </Button>
        <IconButton
          onClick={() => loadContratos(tab)}
          disabled={loading}
          title="Refrescar"
          size="small"
        >
          <RefreshIcon />
        </IconButton>
      </Box>

      {/* Loading */}
      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Table */}
      {!loading && (
        <>
          {contratos.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
              No hay contratos con este filtro
            </Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={allTestadosSelected}
                        indeterminate={someTestadosSelected}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        disabled={testadosIds.length === 0}
                      />
                    </TableCell>
                    <TableCell>RFC</TableCell>
                    <TableCell>Nombre</TableCell>
                    <TableCell>Trimestre</TableCell>
                    <TableCell>Estado</TableCell>
                    <TableCell>Archivo</TableCell>
                    <TableCell>Fecha procesado</TableCell>
                    <TableCell align="center">Acciones</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {contratos.map((c) => {
                    const isTestado = c.estado === "TESTADO";
                    const isChecked = selected.has(c.id);
                    return (
                      <TableRow key={c.id} hover selected={isChecked}>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={isChecked}
                            disabled={!isTestado}
                            onChange={(e) => handleSelectRow(c.id, e.target.checked)}
                          />
                        </TableCell>
                        <TableCell>{c.rfc}</TableCell>
                        <TableCell>{c.nombre ?? "—"}</TableCell>
                        <TableCell>{`${c.anio} T${c.periodo}`}</TableCell>
                        <TableCell>
                          <EstadoChip estado={c.estado} />
                        </TableCell>
                        <TableCell sx={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.nombreArchivo}
                        </TableCell>
                        <TableCell>{formatFecha(c.procesadoEn)}</TableCell>
                        <TableCell align="center">
                          <IconButton
                            size="small"
                            title="Eliminar"
                            onClick={() => handleEliminar(c.id)}
                            color="error"
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}
    </Box>
  );
}
