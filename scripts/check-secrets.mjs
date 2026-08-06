import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);

const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{24,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["']?(?!example|placeholder|change-me)[A-Za-z0-9_\-/.+]{8,}/i,
];

const findings = [];
for (const file of files) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (source.includes("\0")) continue;
  if (patterns.some((pattern) => pattern.test(source))) findings.push(file);
}

if (findings.length) {
  for (const file of findings) process.stderr.write(`possible secret: ${file}\n`);
  process.exit(1);
}

process.stdout.write(`secret-scan-ok files=${files.length}\n`);
