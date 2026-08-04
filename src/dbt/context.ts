import { access } from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';

type Exists = (path: string) => Promise<boolean>;

const fileExists: Exists = async (path) => {
  try {
    await access(path);
    return true;
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

  while (true) {
    if (await exists(join(directory, 'dbt_project.yml'))) return directory;
    if (directory === boundary || directory === parse(directory).root) return undefined;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    if (workspaceRoot && parent !== boundary && !parent.startsWith(`${boundary}${sep}`)) {
      return undefined;
    }
    directory = parent;
  }
}
