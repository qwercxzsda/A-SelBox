import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createTheme, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "./index.css";
import App from "./App.tsx";

const theme = createTheme({
  primaryColor: "cyan",
  primaryShade: 8,
  defaultRadius: "md",
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
});

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Application root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <MantineProvider theme={theme} forceColorScheme="light">
      <App />
    </MantineProvider>
  </StrictMode>,
);
