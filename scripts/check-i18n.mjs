import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const rootPath = decodeURIComponent(root.pathname).replace(/^\/(?:([A-Za-z]:))/, "$1");
const dictionaryPath = join(rootPath, "locales", "hu.json");
const dictionary = JSON.parse(readFileSync(dictionaryPath, "utf8"));
const failures = [];
const localeFiles = readdirSync(join(rootPath, "locales")).filter((name) => name.endsWith(".json"));
if (localeFiles.length !== 1 || localeFiles[0] !== "hu.json") failures.push("only locales/hu.json is allowed during initial development");

for (const [key, value] of Object.entries(dictionary)) {
  if (!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/.test(key)) failures.push(`invalid key: ${key}`);
  if (!/^(?:core|workspace|module\.[a-z][a-z0-9-]*|app\.[a-z][a-z0-9-]*)\./.test(key)) {
    failures.push(`key outside an owned namespace: ${key}`);
  }
  if (typeof value !== "string" || !value.trim()) failures.push(`empty value: ${key}`);
}

const sourceFiles = ["apps", "packages", "modules"]
  .flatMap((directory) => walkIfPresent(join(rootPath, directory)));
for (const file of sourceFiles) {
  const extension = extname(file);
  if (![".tsx", ".html", ".css"].includes(extension)) continue;
  const source = readFileSync(file, "utf8");
  const displayPath = relative(rootPath, file);
  if (extension === ".tsx") {
    if (/>\s*[\p{L}\p{N}][^<>{}]*\s*<\/[A-Za-z]/u.test(source)) failures.push(`visible JSX literal: ${displayPath}`);
    if (/\b(?:aria-label|title|placeholder|alt)\s*=\s*["'][^"'{]+["']/.test(source)) failures.push(`visible attribute literal: ${displayPath}`);
  }
  for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
    if (!(match[1] in dictionary)) failures.push(`missing translation key: ${match[1]} (${displayPath})`);
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

function walkIfPresent(directory) {
  return existsSync(directory) ? walk(directory) : [];
}
