import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev"], {
  env: { ...process.env, NEXT_PUBLIC_ENABLE_REACT_INSPECTOR: "1" },
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
