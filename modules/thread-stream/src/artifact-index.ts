import type { ArtifactFileEntry } from "@synaius/protocol";
import type { ThreadTurnGroup } from "./activity.ts";

export function projectThreadArtifactFiles(turns: ThreadTurnGroup[]): ArtifactFileEntry[] {
  const files = new Map<string, ArtifactFileEntry & { order: number }>();
  let order = 0;
  for (const turn of turns) {
    for (const line of turn.lines) {
      if (line.kind !== "activity" || line.activity.kind !== "fileChange") continue;
      for (const change of line.activity.changes) {
        const identity = artifactPathIdentity(change.path);
        const previous = files.get(identity);
        files.set(identity, {
          path: change.path,
          name: artifactFileName(change.path),
          changeKind: change.kind,
          diff: change.diff,
          occurrences: (previous?.occurrences ?? 0) + 1,
          turnId: line.activity.turnId ?? turn.id,
          itemId: line.activity.id,
          order,
        });
        order += 1;
      }
    }
  }
  return [...files.values()]
    .sort((left, right) => right.order - left.order || left.path.localeCompare(right.path))
    .map(({ order: _order, ...file }) => file);
}

function artifactPathIdentity(path: string) {
  const normalized = path.replaceAll("\\", "/");
  return /^[a-z]:\//i.test(normalized) ? normalized.toLocaleLowerCase() : normalized;
}

function artifactFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
