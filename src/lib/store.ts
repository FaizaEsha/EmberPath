import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Run, PublicRun } from "./workflow";

const directory = () =>
  path.resolve(process.env.EMBERPATH_DATA_DIR || ".data", "runs");
const file = (id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid run ID.");
  return path.join(directory(), `${id}.json`);
};
export async function readRun(id: string): Promise<Run | null> {
  try {
    return JSON.parse(await readFile(file(id), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function writeRun(run: Run) {
  await mkdir(directory(), { recursive: true });
  const target = file(run.id);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(run), { mode: 0o600 });
  await rename(temporary, target);
}
export async function updateRun(id: string, update: (run: Run) => void) {
  const run = await readRun(id);
  if (!run) throw new Error("Run not found.");
  update(run);
  await writeRun(run);
  return run;
}
export const publicRun = ({ owner: _owner, ...run }: Run): PublicRun => run;
export async function listRuns(owner: string) {
  await mkdir(directory(), { recursive: true });
  const files = (await readdir(directory())).filter((f) => f.endsWith(".json"));
  const runs = await Promise.all(files.map((f) => readRun(f.slice(0, -5))));
  return runs
    .filter((r): r is Run => !!r && r.owner === owner)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30)
    .map(publicRun);
}
