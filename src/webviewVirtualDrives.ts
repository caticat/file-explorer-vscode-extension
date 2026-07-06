export const VIRTUAL_DRIVES_PATH = "simple-file-explorer://drives";

export function isVirtualDrivesPath(value: string): boolean {
  return value === VIRTUAL_DRIVES_PATH;
}

export function isWindowsDriveRoot(value: string): boolean {
  return /^[A-Za-z]:[\\/]?$/.test(value);
}
