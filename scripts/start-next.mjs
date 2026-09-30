import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const hostname = process.env.WORKFINDER_HOSTNAME ?? "127.0.0.1";
const nextProcess = spawn(
  process.execPath,
  [nextCli, "start", "--hostname", hostname],
  { stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => nextProcess.kill(signal));
}

nextProcess.once("error", (error) => {
  console.error("Unable to start the Next.js server:", error);
  process.exitCode = 1;
});

nextProcess.once("exit", (code, signal) => {
  process.exitCode =
    signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : (code ?? 1);
});
