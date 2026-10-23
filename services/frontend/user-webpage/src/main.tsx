import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { RouterProvider } from "@tanstack/react-router";
import { appTheme } from "./design-system";
import "@mantine/core/styles.css";
import "./design-system.css";
import "./interaction-states.css";
import "./index.css";
import { appRouter } from "./router";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Application root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <MantineProvider theme={appTheme} forceColorScheme="light">
      <RouterProvider router={appRouter} />
    </MantineProvider>
  </StrictMode>,
);
