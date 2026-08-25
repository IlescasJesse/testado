"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  Tab,
  TextField,
  Typography,
} from "@mui/material";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import ListAltIcon from "@mui/icons-material/ListAlt";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DownloadIcon from "@mui/icons-material/Download";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import SearchIcon from "@mui/icons-material/Search";
import InputAdornment from "@mui/material/InputAdornment";
import { apiGet, apiPost, urlArchivo } from "@/lib/api";
import type {
  ContratoDTO,
  Estado,
  LoteAccionIniciado,
  ProgresoAccion,
  ResultadoAccion,
} from "@/lib/api";
import VisorPdf from "@/components/VisorPdf";

type TabIndex = 0 | 1 | 2;

const TAB_FILTROS: Array<Estado | null> = [null, "BLOQUEADO", "DESBLOQUEADO"];
const ETIQUETAS_TAB = ["Todos", "Bloqueados", "Desbloqueados"];

const FILAS_POR_PAGINA = [10, 25, 50] as const;

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
  const [accionError, setAccionError] = useState<string | null>(null);
  const [accionSuccess, setAccionSuccess] = useState<string | null>(null);
  const [bloqueando, setBloqueando] = useState(false);
  const [visorId, setVisorId] = useState<number | null>(null);
  const [visorTitulo, setVisorTitulo] = useState<string>("");
  const [pagina, setPagina] = useState(0);
  const [filasPorPagina, setFilasPorPagina] = useState(25);
  const [dialogPwdOpen, setDialogPwdOpen] = useState(false);
  const [pwdInput, setPwdInput] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [accionResultados, setAccionResultados] = useState<ResultadoAccion[]>([]);
  const [accionTotal, setAccionTotal] = useState(0);

  const loadContratos = useCallback(async (tabIdx: TabIndex) => {
    setLoading(true);
    setLoadError(null);
    try {
      const estado = TAB_FILTROS[tabIdx];
      const path = estado ? `/api/contratos?estado=${estado}` : "/api/contratos";
      const data = await apiGet<{ contratos: ContratoDTO[] }>(path);
      setContratos(data.contratos);
      setPagina(0);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error al cargar contratos");
      setContratos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelected(new Set<number>());
    setAccionError(null);
    setAccionSuccess(null);
    loadContratos(tab);
  }, [tab, loadContratos]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTab(newValue as TabIndex);
  };

  // ── Estados para cada acción ──────────────────────────────────────────────────

  const idsBloqueables = contratos
    .filter((c) => c.estado === "TESTADO" || c.estado === "DESBLOQUEADO")
    .map((c) => c.id);
  const idsDesbloqueables = contratos
    .filter((c) => c.estado === "BLOQUEADO")
    .map((c) => c.id);

  const selBloqueables = idsBloqueables.filter((id) => selected.has(id));
  const selDesbloqueables = idsDesbloqueables.filter((id) => selected.has(id));
  const hayMezcla = selBloqueables.length > 0 && selDesbloqueables.length > 0;

  const allBloqueablesSelected =
    idsBloqueables.length > 0 && idsBloqueables.every((id) => selected.has(id));
  const allDesbloqueablesSelected =
    idsDesbloqueables.length > 0 && idsDesbloqueables.every((id) => selected.has(id));
  const someSelected =
    idsBloqueables.some((id) => selected.has(id)) || idsDesbloqueables.some((id) => selected.has(id));
  const allSelected = allBloqueablesSelected && allDesbloqueablesSelected;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelected(new Set<number>([...idsBloqueables, ...idsDesbloqueables]));
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

  const esSeleccionable = (c: ContratoDTO) =>
    c.estado === "TESTADO" || c.estado === "BLOQUEADO" || c.estado === "DESBLOQUEADO";

  const handleVerPdf = (c: ContratoDTO) => {
    setVisorTitulo(`${c.rfc} — ${c.nombre ?? c.nombreArchivo}`);
    setVisorId(c.id);
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

  // ── Polling de progreso contrato-por-contrato (bloquear/desbloquear) ──────────
  // El POST responde de inmediato con un loteId; cada contrato se procesa en
  // segundo plano en el servidor. Se consulta /progreso cada 1s para ir
  // mostrando cada contrato apenas se resuelve, en vez de esperar en silencio
  // a que termine todo el lote (lo que con lotes grandes podía exceder el
  // timeout del proxy de Next.js y mostrar "socket hang up").
  const pollAccionHastaCompletar = (
    endpoint: "bloquear" | "desbloquear",
    loteId: string,
  ): Promise<ResultadoAccion[]> => {
    return new Promise((resolve, reject) => {
      const tick = async () => {
        try {
          const data = await apiGet<ProgresoAccion>(
            `/api/contratos/${endpoint}/progreso?loteId=${encodeURIComponent(loteId)}`,
          );
          setAccionResultados(data.hechos);
          if (data.completado) {
            resolve(data.hechos);
          } else {
            setTimeout(tick, 1000);
          }
        } catch (err) {
          reject(err instanceof Error ? err : new Error("Error al consultar progreso"));
        }
      };
      tick();
    });
  };

  // ── Bloquear ──────────────────────────────────────────────────────────────────

  const handleBloquear = async () => {
    const ids = Array.from(selected).filter((id) => idsBloqueables.includes(id));
    if (ids.length === 0) return;

    setBloqueando(true);
    setAccionError(null);
    setAccionSuccess(null);
    setAccionResultados([]);
    setAccionTotal(ids.length);

    try {
      const result = await apiPost<LoteAccionIniciado | { success: false; message: string }>(
        "/api/contratos/bloquear",
        { ids },
      );

      if (result.status === 409) {
        const errData = result.data as { success: false; message?: string };
        const detail = errData.message ? ` — ${errData.message}` : "";
        setAccionError(
          `qpdf no disponible en este servidor. No es posible bloquear contratos sin qpdf instalado.${detail}`,
        );
        return;
      }

      const { loteId } = result.data as LoteAccionIniciado;
      const hechos = await pollAccionHastaCompletar("bloquear", loteId);
      const ok = hechos.filter((h) => h.ok).length;
      const fallidos = hechos.length - ok;
      setAccionSuccess(
        `Bloqueados: ${ok} contratos${fallidos > 0 ? ` — ${fallidos} con error` : ""}`,
      );
      setSelected(new Set<number>());
      await loadContratos(tab);
    } catch (err) {
      setAccionError(err instanceof Error ? err.message : "Error al bloquear contratos");
    } finally {
      setBloqueando(false);
    }
  };

  // ── Desbloquear ───────────────────────────────────────────────────────────────

  const abrirDialogDesbloquear = () => {
    setPwdInput("");
    setDialogPwdOpen(true);
  };

  const handleDesbloquear = async () => {
    const ids = Array.from(selected).filter((id) => idsDesbloqueables.includes(id));
    if (ids.length === 0) return;

    setDialogPwdOpen(false);
    setBloqueando(true);
    setAccionError(null);
    setAccionSuccess(null);
    setAccionResultados([]);
    setAccionTotal(ids.length);

    try {
      const result = await apiPost<LoteAccionIniciado | { success: false; message?: string }>(
        "/api/contratos/desbloquear",
        { ids, password: pwdInput },
      );

      if (result.status === 401) {
        setAccionError("Contraseña incorrecta. No se puede desbloquear.");
        return;
      }

      const { loteId } = result.data as LoteAccionIniciado;
      const hechos = await pollAccionHastaCompletar("desbloquear", loteId);
      const ok = hechos.filter((h) => h.ok).length;
      const fallidos = hechos.length - ok;
      setAccionSuccess(
        `Desbloqueados: ${ok} contratos${fallidos > 0 ? ` — ${fallidos} con error` : ""}`,
      );
      setSelected(new Set<number>());
      await loadContratos(tab);
    } catch (err) {
      setAccionError(err instanceof Error ? err.message : "Error al desbloquear contratos");
    } finally {
      setBloqueando(false);
    }
  };

  // ── Búsqueda ──────────────────────────────────────────────────────────────────

  const contratosFiltrados = busqueda.trim()
    ? contratos.filter((c) =>
        (c.nombre ?? "").toLowerCase().includes(busqueda.trim().toLowerCase()),
      )
    : contratos;

  const handleBusquedaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBusqueda(e.target.value);
    setPagina(0);
  };

  // ── Paginación ────────────────────────────────────────────────────────────────

  const paginated = contratosFiltrados.slice(
    pagina * filasPorPagina,
    (pagina + 1) * filasPorPagina,
  );

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPagina(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFilasPorPagina(parseInt(event.target.value, 10));
    setPagina(0);
  };

  const iconosTab = [<ListAltIcon key="t" />, <LockIcon key="b" />, <LockOpenIcon key="d" />];

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto", p: 3 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Bloquear Contratos
      </Typography>

      {/* Tabs: Todos | Bloqueados | Desbloqueados */}
      <Tabs value={tab} onChange={handleTabChange} sx={{ mb: 2 }}>
        {ETIQUETAS_TAB.map((label, i) => (
          <Tab key={label} icon={iconosTab[i]} iconPosition="start" label={label} />
        ))}
      </Tabs>

      {/* Alertas */}
      {accionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setAccionError(null)}>
          {accionError}
        </Alert>
      )}
      {accionSuccess && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setAccionSuccess(null)}>
          {accionSuccess}
        </Alert>
      )}
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLoadError(null)}>
          {loadError}
        </Alert>
      )}

      {/* Barra de acciones */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <TextField
          size="small"
          placeholder="Buscar por nombre..."
          value={busqueda}
          onChange={handleBusquedaChange}
          sx={{ minWidth: 240 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />

        <Typography variant="body2" color="text.secondary">
          {selected.size} seleccionados
          {hayMezcla
            ? ` (${selBloqueables.length} p/bloquear, ${selDesbloqueables.length} p/desbloquear)`
            : selBloqueables.length > 0
              ? " (bloqueables)"
              : selDesbloqueables.length > 0
                ? " (desbloqueables)"
                : ""}
        </Typography>

        <Button
          variant="contained"
          startIcon={<LockIcon />}
          disabled={selBloqueables.length === 0 || bloqueando}
          onClick={handleBloquear}
        >
          {bloqueando ? "Procesando..." : "Bloquear seleccionados"}
        </Button>

        <Button
          variant="outlined"
          color="warning"
          startIcon={<LockOpenIcon />}
          disabled={selDesbloqueables.length === 0 || bloqueando}
          onClick={abrirDialogDesbloquear}
        >
          Desbloquear seleccionados
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

      {/* Progreso contrato por contrato al bloquear/desbloquear */}
      {bloqueando && accionTotal > 0 && (
        <Paper variant="outlined" sx={{ mb: 2, p: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2">
              Procesando {accionResultados.length} / {accionTotal} contratos...
            </Typography>
          </Box>
          <Box sx={{ maxHeight: 240, overflowY: "auto" }}>
            {accionResultados.map((r) => (
              <Box
                key={r.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  py: 0.5,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                }}
              >
                {r.ok ? (
                  <CheckCircleIcon color="success" fontSize="small" />
                ) : (
                  <ErrorOutlineIcon color="error" fontSize="small" />
                )}
                <Typography variant="body2">{r.rfc ?? `#${r.id}`}</Typography>
                {r.nombre && (
                  <Typography variant="body2" color="text.secondary">
                    {r.nombre}
                  </Typography>
                )}
                {!r.ok && r.mensaje && (
                  <Typography variant="caption" color="error">
                    {r.mensaje}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {/* Loading */}
      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Visor PDF */}
      {visorId !== null && (
        <VisorPdf
          open={visorId !== null}
          id={visorId}
          titulo={visorTitulo}
          onClose={() => setVisorId(null)}
        />
      )}

      {/* Diálogo de contraseña para desbloquear */}
      <Dialog open={dialogPwdOpen} onClose={() => setDialogPwdOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <VpnKeyIcon color="warning" />
          Contraseña de desbloqueo
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Ingresa la contraseña maestra para desbloquear {selDesbloqueables.length} contrato
           {selDesbloqueables.length !== 1 ? "s" : ""}.
          </Typography>
          <TextField
            label="Contraseña"
            type="password"
            value={pwdInput}
            onChange={(e) => setPwdInput(e.target.value)}
            fullWidth
            autoFocus
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDialogPwdOpen(false)}>Cancelar</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleDesbloquear}
            disabled={pwdInput.trim() === ""}
          >
            Desbloquear
          </Button>
        </DialogActions>
      </Dialog>

      {/* Tabla */}
      {!loading && (
        <>
          {contratosFiltrados.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
              No hay contratos con este filtro
            </Typography>
          ) : (
            <Paper variant="outlined">
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={allSelected}
                          indeterminate={someSelected && !allSelected}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          disabled={idsBloqueables.length === 0 && idsDesbloqueables.length === 0}
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
                    {paginated.map((c) => {
                      const isChecked = selected.has(c.id);
                      return (
                        <TableRow key={c.id} hover selected={isChecked}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={isChecked}
                              disabled={!esSeleccionable(c)}
                              onChange={(e) => handleSelectRow(c.id, e.target.checked)}
                            />
                          </TableCell>
                          <TableCell>{c.rfc}</TableCell>
                          <TableCell>{c.nombre ?? "—"}</TableCell>
                          <TableCell>{`${c.anio} T${c.periodo}`}</TableCell>
                          <TableCell>
                            <EstadoChip estado={c.estado} />
                          </TableCell>
                          <TableCell
                            sx={{
                              maxWidth: 200,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.nombreArchivo}
                          </TableCell>
                          <TableCell>{formatFecha(c.procesadoEn)}</TableCell>
                          <TableCell align="center">
                            <IconButton
                              size="small"
                              aria-label="Ver PDF"
                              title="Ver PDF"
                              onClick={() => handleVerPdf(c)}
                            >
                              <VisibilityIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              aria-label="Descargar PDF"
                              title="Descargar PDF"
                              onClick={() => window.open(urlArchivo(c.id, true), "_blank")}
                            >
                              <DownloadIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              title="Eliminar"
                              aria-label="Eliminar contrato"
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
              <TablePagination
                component="div"
                count={contratosFiltrados.length}
                page={pagina}
                onPageChange={handleChangePage}
                rowsPerPage={filasPorPagina}
                onRowsPerPageChange={handleChangeRowsPerPage}
                rowsPerPageOptions={[...FILAS_POR_PAGINA]}
                labelRowsPerPage="Filas por página"
              />
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}
