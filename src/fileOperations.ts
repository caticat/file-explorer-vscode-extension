import * as fs from "node:fs";
import * as path from "node:path";

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function validateFileName(
  value: string,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  if (!value.trim()) return "Name is required.";
  if (value === "." || value === "..") return "This name is not allowed.";
  if (value.includes("/") || value.includes("\\")) return "Name cannot contain path separators.";

  if (platform === "win32") {
    if (/[<>:"|?*]/.test(value)) {
      return "Name contains characters that are not allowed on Windows.";
    }
    if (/[. ]$/.test(value)) {
      return "Name cannot end with a space or period on Windows.";
    }
    if (WINDOWS_RESERVED_NAMES.test(value)) {
      return "This name is reserved on Windows.";
    }
  }

  return undefined;
}

export function nextCopyName(name: string, index: number): string {
  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  return `${stem} copy${index === 1 ? "" : ` ${index}`}${extension}`;
}

export function isPathInsideOrEqualPath(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function copyItem(source: string, target: string): Promise<void> {
  const stat = await fs.promises.lstat(source);
  if (!stat.isDirectory()) {
    await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    return;
  }

  if (isPathInsideOrEqualPath(target, source)) {
    await copyDirectoryAllowingNestedTarget(source, target, target);
    return;
  }

  await fs.promises.cp(source, target, { recursive: true, errorOnExist: true });
}

async function copyDirectoryAllowingNestedTarget(
  source: string,
  target: string,
  excludedTargetRoot: string
): Promise<void> {
  await fs.promises.mkdir(target);
  const entries = await fs.promises.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    if (isPathInsideOrEqualPath(sourcePath, excludedTargetRoot)) {
      continue;
    }

    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryAllowingNestedTarget(sourcePath, targetPath, excludedTargetRoot);
    } else if (entry.isSymbolicLink()) {
      await fs.promises.symlink(await fs.promises.readlink(sourcePath), targetPath);
    } else {
      await fs.promises.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
    }
  }
}
