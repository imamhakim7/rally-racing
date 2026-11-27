import { createHash } from "node:crypto";

/**
 * First 8 hex characters of the SHA-256 of the asset bytes.
 *
 * 8 hex = 32 bits of collision space; ample for a build manifest where a collision
 * is detected at build time anyway (two different assets targeting one URL).
 */
export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

/** `/assets/models/gate-arch.1a2b3c4d.glb` */
export function hashedFileName(logicalName: string, hash: string, ext: string): string {
  return `${logicalName}.${hash}.${ext}`;
}

/** Split `gate-arch.glb` into `{ base: "gate-arch", ext: "glb" }` (ext lower-cased, no dot). */
export function splitExt(fileName: string): { base: string; ext: string } {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return { base: fileName, ext: "" };
  return { base: fileName.slice(0, dot), ext: fileName.slice(dot + 1).toLowerCase() };
}
