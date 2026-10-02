import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { appTheme } from "./design-system";
import "@mantine/core/styles.css";
import "./design-system.css";
import "./index.css";
import App from "./App.tsx";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Application root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <MantineProvider theme={appTheme} forceColorScheme="light">
      <App />
    </MantineProvider>
  </StrictMode>,
);
