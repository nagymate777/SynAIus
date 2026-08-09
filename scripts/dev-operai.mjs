import { spawn } from "node:child_process";

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [
  spawn(npmExecutable, ["run", "dev", "--workspace", "@synaius/operai-bridge"], {
    stdio: "inherit",
  }),
  spawn(npmExecutable, ["run", "dev", "--workspace", "@synaius/operai"], {
    stdio: "inherit",
  }),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => {
    if (!child.killed) child.kill();
  });
  process.exitCode = exitCode;
}

children.forEach((child) => {
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) stop(signal ? 1 : code ?? 0);
  });
});
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
