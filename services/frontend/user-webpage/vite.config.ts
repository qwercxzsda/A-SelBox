import { defineConfig, loadEnv } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { validateBuildConfig } from "./src/api/runtime-config.ts";

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    validateBuildConfig(loadEnv(mode, process.cwd(), "VITE_"));
  }

  return {
    server: {
      allowedHosts: ["host.docker.internal"],
    },
    plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  };
});
