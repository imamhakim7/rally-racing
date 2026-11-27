import type { AssetKind } from "./types.ts";

/** Long-lived, immutable CDN caching — safe because every URL is content-addressed. */
export const CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable";

const CONTENT_TYPES: Record<string, string> = {
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  bin: "application/octet-stream",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  ktx2: "image/ktx2",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
};

const KIND_BY_EXT: Record<string, AssetKind> = {
  glb: "model",
  gltf: "model",
  png: "texture",
  jpg: "texture",
  jpeg: "texture",
  webp: "texture",
  avif: "texture",
  ktx2: "texture",
  wav: "audio",
  ogg: "audio",
  mp3: "audio",
};

/** Directory bucket an asset kind is served from, under the CDN base URL. */
export const KIND_DIR: Record<AssetKind, string> = {
  model: "models",
  texture: "textures",
  audio: "audio",
  unknown: "misc",
};

export function contentTypeFor(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";
}

/** `unknown` is a build error surfaced by the pipeline, not a servable kind. */
export function detectKind(ext: string): AssetKind {
  return KIND_BY_EXT[ext.toLowerCase()] ?? "unknown";
}
