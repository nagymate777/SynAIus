import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const rootPath = decodeURIComponent(new URL("../", import.meta.url).pathname).replace(/^\/(?:([A-Za-z]:))/, "$1");
const layers = ["packages", "modules", "apps"];
const units = [];
const failures = [];

for (const layer of layers) {
  const layerPath = join(rootPath, layer);
  if (!existsSync(layerPath)) continue;
  for (const name of readdirSync(layerPath)) {
    const unitPath = join(layerPath, name);
    const manifestPath = join(unitPath, "package.json");
    if (!statSync(unitPath).isDirectory() || !existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    units.push({ layer, name, path: unitPath, packageName: manifest.name, manifest });
  }
}

const byPackageName = new Map(units.map((unit) => [unit.packageName, unit]));
for (const unit of units) {
  const dependencies = {
    ...unit.manifest.dependencies,
    ...unit.manifest.devDependencies,
    ...unit.manifest.peerDependencies,
  };
  for (const dependency of Object.keys(dependencies)) {
    const target = byPackageName.get(dependency);
    if (target && !dependencyIsAllowed(unit, target)) {
      failures.push(`${unit.layer}/${unit.name}: tiltott függőség: ${dependency}`);
    }
  }

  const sourcePath = join(unit.path, "src");
  if (!existsSync(sourcePath)) continue;
  for (const file of walk(sourcePath)) {
    if (![".ts", ".tsx", ".js", ".mjs"].includes(extname(file))) continue;
    const source = readFileSync(file, "utf8");
    for (const specifier of importedSpecifiers(source)) {
      const packageTarget = [...byPackageName.entries()]
        .find(([packageName]) => specifier === packageName || specifier.startsWith(`${packageName}/`))?.[1];
      if (packageTarget && !dependencyIsAllowed(unit, packageTarget)) {
        failures.push(`${relative(rootPath, file)}: tiltott import: ${specifier}`);
      }
      if (specifier.startsWith(".")) {
        const targetPath = resolve(dirname(file), specifier);
        const relativeTarget = relative(rootPath, targetPath).split(sep);
        const target = units.find((candidate) => candidate.layer === relativeTarget[0] && candidate.name === relativeTarget[1]);
        if (target && target !== unit && !dependencyIsAllowed(unit, target)) {
          failures.push(`${relative(rootPath, file)}: réteghatáron átmenő relatív import: ${specifier}`);
        }
      }
    }
  }
}

if (failures.length) {
  failures.forEach((failure) => process.stderr.write(`${failure}\n`));
  process.exit(1);
}
process.stdout.write(`boundaries-ok units=${units.length}\n`);

function dependencyIsAllowed(source, target) {
  if (source.layer === "packages") return target.layer === "packages";
  if (source.layer === "modules") return target.layer !== "apps";
  if (source.layer === "apps") return target.layer !== "apps" || source === target;
  return false;
}

function importedSpecifiers(source) {
  const matches = source.matchAll(/(?:from\s+|import\s*\(|import\s+)["']([^"']+)["']/g);
  return [...matches].map((match) => match[1]);
}

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
