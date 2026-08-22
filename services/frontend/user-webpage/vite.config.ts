import { defineConfig, loadEnv } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

const REQUIRED_PRODUCTION_SETTINGS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
] as const;

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    const environment = loadEnv(mode, process.cwd(), "VITE_");
    const missingSettings = REQUIRED_PRODUCTION_SETTINGS.filter((name) => {
      const value: unknown = environment[name];
      return typeof value !== "string" || value.trim().length === 0;
    });
    if (missingSettings.length > 0) {
      throw new Error(`Production build requires ${missingSettings.join(", ")}`);
    }
  }

  return {
    server: {
      allowedHosts: ["host.docker.internal"],
    },
    plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  };
});
