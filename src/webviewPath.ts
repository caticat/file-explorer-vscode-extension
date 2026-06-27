export type WebviewPlatform = string;

export interface PathSegment {
  label: string;
  path: string;
}

export function splitPathForPlatform(
  value: string,
  platform: WebviewPlatform
): PathSegment[] {
  if (platform === "win32") {
    const normalized = value.replaceAll("/", "\\");
    const rootMatch = normalized.match(/^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+\\?)/);
    const root = rootMatch?.[0] ?? "";
    const remainder = normalized.slice(root.length).split("\\").filter(Boolean);
    const result: PathSegment[] = [];
    let current = root || normalized;
    if (root) {
      result.push({ label: root.replace(/\\$/, ""), path: root });
    }
    for (const segment of remainder) {
      current = current.endsWith("\\") ? `${current}${segment}` : `${current}\\${segment}`;
      result.push({ label: segment, path: current });
    }
    return result;
  }

  const segments = value.split("/").filter(Boolean);
  const result: PathSegment[] = [{ label: "/", path: "/" }];
  let current = "";
  for (const segment of segments) {
    current += `/${segment}`;
    result.push({ label: segment, path: current });
  }
  return result;
}

export function isPathInsideOrEqualForPlatform(
  candidate: string,
  root: string,
  platform: WebviewPlatform
): boolean {
  const normalizedCandidate = normalizeForComparisonForPlatform(candidate, platform);
  const normalizedRoot = normalizeForComparisonForPlatform(root, platform);
  if (normalizedCandidate === normalizedRoot) return true;
  const separator = platform === "win32" ? "\\" : "/";
  return normalizedCandidate.startsWith(`${normalizedRoot}${separator}`);
}

export function dirnameForPlatform(value: string, platform: WebviewPlatform): string {
  const normalized = value.replace(/[\\/]+$/, "");
  if (platform === "win32") {
    if (/^[A-Za-z]:$/.test(normalized)) return `${normalized}\\`;
    const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
    if (index <= 2 && /^[A-Za-z]:/.test(normalized)) return `${normalized.slice(0, 2)}\\`;
    return index > 0 ? normalized.slice(0, index) : value;
  }
  if (!normalized || normalized === "/") return "/";
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

export function basenameForPlatform(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return normalized.slice(index + 1);
}

export function normalizeForComparisonForPlatform(
  value: string,
  platform: WebviewPlatform
): string {
  const normalized = value.replace(/[\\/]+$/, "");
  return platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}
