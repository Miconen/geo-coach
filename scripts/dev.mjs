import { spawn } from "node:child_process";

const children = [];

function launch(name, cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });
  children.push(child);
  return child;
}

// Start local Postgres via compose.dev.yml (non-fatal if already running externally)
launch("postgres", "docker", ["compose", "-f", "compose.dev.yml", "up", "-d", "postgres"]);

// Start SvelteKit dev server with HMR + dev login enabled
launch("web", "pnpm", ["--filter", "@geo-coach/web", "dev"], {
  NODE_ENV: "development",
  DATABASE_URL:
    process.env.DATABASE_URL ?? "postgres://geocoach:geocoach@localhost:5432/geocoach",
});

// Start local Companion (TS server + Vite watch for recording page) with fake transcriber by default
launch("companion", "pnpm", ["--filter", "@geo-coach/companion", "dev"], {
  TRANSCRIBER_MODE: process.env.TRANSCRIBER_MODE ?? "fake",
  GEOCOACH_SERVER_URL: process.env.GEOCOACH_SERVER_URL ?? "http://localhost:5173",
});
launch("companion-ui", "pnpm", ["--filter", "@geo-coach/companion", "dev:ui"]);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const c of children) c.kill(sig);
    process.exit(0);
  });
}
