"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Box,
  Tooltip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import { urlArchivo } from "@/lib/api";

interface VisorPdfProps {
  open: boolean;
  id: number;
  titulo: string;
  onClose: () => void;
}

export default function VisorPdf({ open, id, titulo, onClose }: VisorPdfProps): React.JSX.Element {
  const handleDescargar = () => {
    window.open(urlArchivo(id, true), "_blank");
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{ sx: { height: "95vh", display: "flex", flexDirection: "column" } }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pr: 1,
          py: 1,
        }}
      >
        <Box
          component="span"
          sx={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            mr: 1,
          }}
        >
          {titulo}
        </Box>
        <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
          <Tooltip title="Descargar PDF">
            <IconButton
              aria-label="Descargar PDF"
              onClick={handleDescargar}
              size="small"
            >
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Cerrar visor">
            <IconButton
              aria-label="Cerrar visor"
              onClick={onClose}
              size="small"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </DialogTitle>

      <DialogContent
        dividers
        sx={{ flex: 1, p: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}
      >
        <Box
          component="iframe"
          src={urlArchivo(id)}
          title={`Visor PDF — ${titulo}`}
          sx={{ border: 0, width: "100%", height: "80vh", flex: 1 }}
        />
      </DialogContent>
    </Dialog>
  );
}
