// Renders DetailDrawer alone (served by Vite in development only) so e2e specs can check
// options that no workspace drawer uses yet. `?actions` adds a header action.
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "../../../src/design-system.css";
import "../../../src/index.css";
import { appTheme } from "../../../src/design-system.ts";
import { DetailDrawer } from "../../../src/DetailDrawer.tsx";

const params = new URLSearchParams(globalThis.location.search);

function Harness() {
  const [opened, setOpened] = useState(true);
  const [edits, setEdits] = useState(0);
  return h(
    "main",
    null,
    h(Button, { onClick: () => setOpened(true) }, "Open month"),
    h(
      DetailDrawer,
      {
        opened,
        onClose: () => setOpened(false),
        width: "record",
        title: "April 2026",
        context: "Amazon.de · EUR",
        closeLabel: params.has("closeLabel") ? params.get("closeLabel") : undefined,
        headerActions: params.has("actions")
          ? h(Button, { size: "compact-sm", onClick: () => setEdits((count) => count + 1) }, "Edit")
          : undefined,
      },
      h("p", null, `Edits: ${String(edits)}`),
    ),
  );
}

createRoot(globalThis.document.getElementById("root")).render(
  h(
    StrictMode,
    null,
    h(MantineProvider, { theme: appTheme, forceColorScheme: "light" }, h(Harness)),
  ),
);
