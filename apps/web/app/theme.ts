"use client";
import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    primary: {
      main: "#621132",
      light: "#8a1846",
      dark: "#3d0a1f",
      contrastText: "#ffffff",
    },
    success: { main: "#2e7d32" },
    error: { main: "#d32f2f" },
    background: { default: "#f5f5f5" },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
});

export default theme;
