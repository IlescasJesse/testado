"use client";

import { usePathname } from "next/navigation";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import LockIcon from "@mui/icons-material/Lock";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import DescriptionIcon from "@mui/icons-material/Description";
import Link from "next/link";

const rutas = [
  { href: "/", label: "Subir & Testar", icon: <CloudUploadIcon /> },
  { href: "/bloquear", label: "Bloquear", icon: <LockIcon /> },
  { href: "/contratos", label: "Contratos", icon: <DescriptionIcon /> },
  { href: "/trimestres", label: "Trimestres", icon: <CalendarMonthIcon /> },
] as const;

export default function NavBar() {
  const pathname = usePathname();

  return (
    <AppBar position="static">
      <Toolbar>
        <Typography variant="h6" component="div" sx={{ flexGrow: 0, mr: 4 }}>
          Testado
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          {rutas.map((r) => {
            const activa = pathname === r.href;
            return (
              <Button
                key={r.href}
                color="inherit"
                component={Link}
                href={r.href}
                startIcon={r.icon}
                sx={{
                  bgcolor: activa ? "rgba(255,255,255,0.18)" : "transparent",
                  "&:hover": { bgcolor: "rgba(255,255,255,0.25)" },
                  fontWeight: activa ? 700 : 400,
                }}
              >
                {r.label}
              </Button>
            );
          })}
        </Box>
      </Toolbar>
    </AppBar>
  );
}
