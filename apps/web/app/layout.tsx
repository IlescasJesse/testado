import type { Metadata } from "next";
import ThemeRegistry from "./ThemeRegistry";
import Box from "@mui/material/Box";
import NavBar from "./NavBar";

export const metadata: Metadata = {
  title: "Testado — Gestión de Contratos",
  description: "Sistema de gestión de contratos — Secretaría de Finanzas Oaxaca",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <ThemeRegistry>
          <NavBar />
          <Box component="main" sx={{ p: 3 }}>
            {children}
          </Box>
        </ThemeRegistry>
      </body>
    </html>
  );
}
