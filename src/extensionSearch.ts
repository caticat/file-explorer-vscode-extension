export function directoryNameFromExcludePattern(pattern: string): string | undefined {
  const normalized = pattern.replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalized || normalized.includes("{") || normalized.includes("}")) {
    return undefined;
  }

  const segments = normalized.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || last.includes("*") || last.includes("?")) {
    return undefined;
  }
  return last;
}

export function createNameMatcher(query: string): (name: string) => boolean {
  if (!query.includes("*") && !query.includes("?")) {
    const normalized = query.toLocaleLowerCase();
    return (name) => name.toLocaleLowerCase().includes(normalized);
  }

  const escaped = query.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const expression = escaped.replaceAll("*", ".*").replaceAll("?", ".");
  const regex = new RegExp(`^${expression}$`, "i");
  return (name) => regex.test(name);
}
