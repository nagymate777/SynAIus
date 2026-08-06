import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const rootPath = decodeURIComponent(root.pathname).replace(/^\/(?:([A-Za-z]:))/, "$1");
const dictionaryPath = join(rootPath, "locales", "hu.json");
const dictionary = JSON.parse(readFileSync(dictionaryPath, "utf8"));
const failures = [];

for (const [key, value] of Object.entries(dictionary)) {
  if (!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/.test(key)) failures.push(`invalid key: ${key}`);
  if (typeof value !== "string" || !value.trim()) failures.push(`empty value: ${key}`);
}

for (const file of walk(join(rootPath, "apps"))) {
  const extension = extname(file);
  if (![".tsx", ".html", ".css"].includes(extension)) continue;
  const source = readFileSync(file, "utf8");
  const displayPath = relative(rootPath, file);
  if (extension === ".tsx") {
    if (/>\s*[\p{L}\p{N}][^<>{}]*\s*<\/[A-Za-z]/u.test(source)) failures.push(`visible JSX literal: ${displayPath}`);
    if (/\b(?:aria-label|title|placeholder|alt)\s*=\s*["'][^"'{]+["']/.test(source)) failures.push(`visible attribute literal: ${displayPath}`);
  }
  if (extension === ".html" && />\s*[\p{L}\p{N}][^<]*</u.test(source)) failures.push(`visible HTML literal: ${displayPath}`);
  if (extension === ".css" && /\bcontent\s*:\s*["'][^"']+/.test(source)) failures.push(`visible CSS literal: ${displayPath}`);
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exit(1);
}

process.stdout.write(`i18n-ok keys=${Object.keys(dictionary).length}\n`);

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
