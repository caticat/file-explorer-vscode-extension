import * as path from "node:path";

export interface ParsedIconTheme {
  file?: string;
  folder?: string;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
}

export function parseIconThemeManifest(
  manifest: Record<string, unknown>,
  manifestDir: string
): ParsedIconTheme {
  const iconDefinitions = asRecord(manifest.iconDefinitions);

  const resolveIconPath = (definitionId: unknown): string | undefined => {
    if (typeof definitionId !== "string") return undefined;
    if (!iconDefinitions) return undefined;
    const definition = asRecord(iconDefinitions[definitionId]);
    const iconPath = definition && typeof definition.iconPath === "string"
      ? definition.iconPath
      : undefined;
    return iconPath ? path.resolve(manifestDir, iconPath) : undefined;
  };

  const resolveIconPathMap = (value: unknown): Record<string, string> => {
    const source = asRecord(value);
    if (!source) return {};
    const result: Record<string, string> = {};
    for (const [key, definitionId] of Object.entries(source)) {
      const iconPath = resolveIconPath(definitionId);
      if (iconPath) {
        result[key.toLocaleLowerCase()] = iconPath;
      }
    }
    return result;
  };

  return {
    file: resolveIconPath(manifest.file),
    folder: resolveIconPath(manifest.folder),
    fileExtensions: resolveIconPathMap(manifest.fileExtensions),
    fileNames: resolveIconPathMap(manifest.fileNames),
    folderNames: resolveIconPathMap(manifest.folderNames)
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
