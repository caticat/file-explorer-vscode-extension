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
