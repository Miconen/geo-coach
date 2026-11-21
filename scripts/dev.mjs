import { spawn, spawnSync } from "node:child_process";

const children = [];

function launch(name, cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });
  child.on("error", (err) => {
    console.error(`[${name}] failed to start: ${err.message}`);
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });
  children.push(child);
  return child;
}

// Docker or Podman, whichever is on PATH (shell aliases don't apply to spawn)
const containerCli =
  process.env.CONTAINER_CLI ??
  ["docker", "podman"].find((cli) => !spawnSync(cli, ["--version"]).error);

// Start local Postgres via compose.dev.yml (non-fatal if already running externally)
if (containerCli) {
  launch("postgres", containerCli, ["compose", "-f", "compose.dev.yml", "up", "-d", "postgres"]);
} else {
  console.warn("[postgres] neither docker nor podman found; expecting Postgres on DATABASE_URL");
}

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
