import type { Metadata } from "next";
import ThemeRegistry from "./ThemeRegistry";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import LockIcon from "@mui/icons-material/Lock";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Testado — Gestión de Contratos",
  description: "Sistema de gestión de contratos — Secretaría de Finanzas Oaxaca",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <ThemeRegistry>
          <AppBar position="static">
            <Toolbar>
              <Typography variant="h6" component="div" sx={{ flexGrow: 0, mr: 4 }}>
                Testado
              </Typography>
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button color="inherit" component={Link} href="/" startIcon={<CloudUploadIcon />}>
                  Subir &amp; Testar
                </Button>
                <Button color="inherit" component={Link} href="/bloquear" startIcon={<LockIcon />}>
                  Bloquear
                </Button>
                <Button color="inherit" component={Link} href="/trimestres" startIcon={<CalendarMonthIcon />}>
                  Trimestres
                </Button>
              </Box>
            </Toolbar>
          </AppBar>
          <Box component="main" sx={{ p: 3 }}>
            {children}
          </Box>
        </ThemeRegistry>
      </body>
    </html>
  );
}
