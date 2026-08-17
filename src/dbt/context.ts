import { stat } from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';

type Exists = (path: string) => Promise<boolean>;

const fileExists: Exists = async (path) => {
  try {
    const info = await stat(path);
    // Require a regular file, not a directory, socket, or other entry.
    return info.isFile();
  } catch {
    return false;
  }
};

export async function findDbtProject(
  dataFile: string,
  workspaceRoot?: string,
  exists: Exists = fileExists,
): Promise<string | undefined> {
  let directory = dirname(resolve(dataFile));
  const boundary = workspaceRoot ? resolve(workspaceRoot) : parse(directory).root;

  // Verify the starting directory is actually inside the workspace boundary.
  if (workspaceRoot && !directory.startsWith(`${boundary}${sep}`) && directory !== boundary) {
    return undefined;
  }

  while (true) {
    // Reject searches that have moved outside the workspace boundary.
    if (workspaceRoot && directory !== boundary && !directory.startsWith(`${boundary}${sep}`)) {
      return undefined;
    }
    if (await exists(join(directory, 'dbt_project.yml'))) return directory;
    if (directory === boundary || directory === parse(directory).root) return undefined;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
