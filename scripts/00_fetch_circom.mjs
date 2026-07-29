// Fetch the circom compiler if it is not already available.
//
// The compiler is a ~15MB platform-specific binary, so it is not committed.
// Rather than making that a manual prerequisite, the kind of step that quietly
// breaks a fresh clone, `npm run compile` fetches it automatically.
//
// Honours an existing `circom` on PATH, so anyone who already has the right
// version keeps using theirs.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

export const CIRCOM_VERSION = "v2.1.9";

const ASSETS = {
  win32: "circom-windows-amd64.exe",
  linux: "circom-linux-amd64",
  darwin: "circom-macos-amd64",
};

export function localCircomPath() {
  return process.platform === "win32" ? "bin/circom.exe" : "bin/circom";
}

/// Whether `cmd` is a working circom of the expected version.
function works(cmd) {
  try {
    const out = execFileSync(cmd, ["--version"], { encoding: "utf8" });
    return out.includes(CIRCOM_VERSION.slice(1));
  } catch {
    return false;
  }
}

/// Resolve a usable circom, downloading it if necessary.
export async function ensureCircom() {
  const local = localCircomPath();
  if (existsSync(local) && works(local)) return local;
  if (works("circom")) {
    console.log("✓ using circom already on PATH");
    return "circom";
  }

  const asset = ASSETS[process.platform];
  if (!asset) {
    throw new Error(
      `no prebuilt circom for platform "${process.platform}", install circom ` +
        `${CIRCOM_VERSION} manually and put it on PATH`
    );
  }
  const url = `https://github.com/iden3/circom/releases/download/${CIRCOM_VERSION}/${asset}`;

  console.log(`→ downloading circom ${CIRCOM_VERSION} for ${process.platform} ...`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} from ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());

  mkdirSync("bin", { recursive: true });
  const tmp = `${local}.partial`;
  writeFileSync(tmp, bytes);
  if (process.platform !== "win32") chmodSync(tmp, 0o755);
  renameSync(tmp, local);

  if (!works(local)) {
    throw new Error(`downloaded circom does not report ${CIRCOM_VERSION}`);
  }
  console.log(`✓ circom ${CIRCOM_VERSION} ready at ${local}`);
  return local;
}

// Allow running this file directly.
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  await ensureCircom();
}
