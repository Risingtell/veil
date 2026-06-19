// Compile the Circom circuit into R1CS + WASM witness generator + symbols.
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Run from project root regardless of where node was invoked.
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const circom = process.platform === "win32" ? "bin\\circom.exe" : "circom";
mkdirSync("build", { recursive: true });

console.log("→ Compiling circuits/withdraw.circom ...");
execFileSync(
  circom,
  [
    "circuits/withdraw.circom",
    "--r1cs",
    "--wasm",
    "--sym",
    "-o",
    "build",
    "-l",
    "node_modules",
  ],
  { stdio: "inherit" }
);
console.log("✓ Compiled. Artifacts: build/withdraw.r1cs, build/withdraw_js/withdraw.wasm");
