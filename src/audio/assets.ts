/**
 * Runtime audio-asset loader (#APEX-17).
 *
 * The asset pipeline (#APEX-6) emits a content-addressed `manifest.json` plus
 * hashed audio files. This module is the pure, headless bridge from that
 * manifest to the Web Audio port's `AudioBusAssets`: it selects the bus loops by
 * logical name, resolves their URLs against the document base, fetches and
 * decodes them. Platform access (fetch/decode) is injected so it is unit-tested
 * with fakes.
 */
import type { AudioBufferLike, AudioBusAssets } from "./graph";

export interface AudioManifestAsset {
  logicalName: string;
  url: string;
  kind: string;
  contentType?: string;
  bytes?: number;
}

export interface AudioManifest {
  assets: AudioManifestAsset[];
}

/** A bus the mix can drive. */
export type AudioBusName = keyof AudioBusAssets;

/**
 * Logical asset name → mix bus. `tyre`/`tire` aliases are accepted so the
 * pipeline can name the loop either way.
 */
const BUS_BY_LOGICAL_NAME: Record<string, AudioBusName> = {
  engine: "engine",
  tyres: "tyres",
  tyre: "tyres",
  tires: "tyres",
  tire: "tyres",
  wind: "wind",
  rain: "rain",
  impact: "impact",
  opponent: "opponent",
};

export interface SelectedAudioAsset {
  bus: AudioBusName;
  logicalName: string;
  url: string;
}

/** Pick the audio assets that map onto a mix bus, in manifest order. */
export function selectAudioBusAssets(manifest: Pick<AudioManifest, "assets">): SelectedAudioAsset[] {
  const selected: SelectedAudioAsset[] = [];
  for (const asset of manifest.assets ?? []) {
    if (asset.kind !== "audio") continue;
    const bus = BUS_BY_LOGICAL_NAME[asset.logicalName.toLowerCase()];
    if (!bus) continue;
    selected.push({ bus, logicalName: asset.logicalName, url: asset.url });
  }
  return selected;
}

/**
 * Resolve a manifest URL against a base. The manifest stores root-absolute
 * `/assets/...` URLs; re-basing them onto `document.baseURI` keeps them correct
 * at a site root *and* under a sub-path (GitHub Pages `base: "./"`). Fully
 * qualified `scheme://` URLs are returned unchanged.
 */
export function resolveAudioUrl(url: string, base: string | URL): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  const relative = url.replace(/^\/+/, "");
  try {
    return new URL(relative, base).href;
  } catch {
    return url;
  }
}

export interface LoadAudioOptions {
  /** Base to resolve relative asset URLs against. Defaults to `document.baseURI`. */
  base?: string | URL;
  /** Fetch an asset as an ArrayBuffer. Defaults to global `fetch`. */
  fetcher?: (url: string) => Promise<ArrayBuffer>;
}

async function defaultFetcher(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`audio asset ${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

/**
 * Fetch and decode every selected bus loop. A single missing/undecodable loop
 * is skipped (that bus stays silent) rather than failing the whole mix — audio
 * is never allowed to break the race.
 */
export async function loadAudioBusAssets(
  manifest: Pick<AudioManifest, "assets">,
  decoder: (data: ArrayBuffer) => Promise<AudioBufferLike | null>,
  options: LoadAudioOptions = {},
): Promise<AudioBusAssets> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const base =
    options.base ?? (typeof document !== "undefined" ? document.baseURI : "http://localhost/");
  const assets: AudioBusAssets = {};
  await Promise.all(
    selectAudioBusAssets(manifest).map(async (selected) => {
      try {
        const data = await fetcher(resolveAudioUrl(selected.url, base));
        const buffer = await decoder(data);
        if (buffer) assets[selected.bus] = buffer;
      } catch {
        // skip this bus
      }
    }),
  );
  return assets;
}
