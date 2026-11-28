import { Document, NodeIO, type Transform } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, draco, meshopt, prune, resample } from "@gltf-transform/functions";
import { Mp3Encoder } from "@breezystack/lamejs";
import { encodeToKTX2 } from "ktx2-encoder";
import { ktx2 } from "ktx2-encoder/gltf-transform";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import * as draco3d from "draco3d";
import sharp from "sharp";
import type { GeometryCodec } from "./types.ts";

/**
 * Decodes a PNG (or other LDR image) to raw RGBA for the Basis/KTX2 encoder.
 * Shared by the glTF `ktx2()` transform and standalone texture encoding.
 */
export const imageDecoder = async (
  buffer: Uint8Array,
): Promise<{ data: Uint8Array; width: number; height: number }> => {
  const { data, info } = await sharp(Buffer.from(buffer))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

let dracoEncoder: Promise<unknown> | undefined;
let dracoDecoder: Promise<unknown> | undefined;
let meshoptReady: Promise<void> | undefined;

function loadDracoEncoder(): Promise<unknown> {
  dracoEncoder ??= draco3d.createEncoderModule();
  return dracoEncoder;
}
function loadDracoDecoder(): Promise<unknown> {
  dracoDecoder ??= draco3d.createDecoderModule();
  return dracoDecoder;
}
function readyMeshopt(): Promise<void> {
  meshoptReady ??= MeshoptEncoder.ready;
  return meshoptReady;
}

/**
 * A NodeIO wired with the extensions both compression codecs and KTX2 need.
 * Dependencies are registered lazily: Draco's WASM is only loaded when a Draco
 * build actually runs, keeping meshopt-only builds fast.
 */
export async function createIO(opts: { draco?: boolean } = {}): Promise<NodeIO> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  await MeshoptDecoder.ready;
  const dependencies: Record<string, unknown> = {
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  };
  if (opts.draco) {
    dependencies["draco3d.encoder"] = await loadDracoEncoder();
    dependencies["draco3d.decoder"] = await loadDracoDecoder();
  }
  io.registerDependencies(
    dependencies as Parameters<NodeIO["registerDependencies"]>[0],
  );
  return io;
}

export interface OptimizeOptions {
  /** Geometry compression codec. Default `meshopt` (no separate decoder CDN needed). */
  geometry?: GeometryCodec;
  /** KTX2 ETC1S quality, 1..255. Default 128. */
  ktxQuality?: number;
}

/**
 * Compress a glTF/GLB asset:
 *   dedup → resample → meshopt|draco geometry → KTX2/Basis textures → prune.
 *
 * Returns the optimized GLB bytes. Deterministic for a given input + options.
 */
export async function optimizeGlb(
  input: Uint8Array,
  opts: OptimizeOptions = {},
): Promise<Uint8Array> {
  const codec: GeometryCodec = opts.geometry ?? "meshopt";
  const io = await createIO({ draco: codec === "draco" });
  const doc = await io.readBinary(input);

  const transforms: Transform[] = [dedup(), resample()];
  if (codec === "draco") {
    // Draco compression is deferred until write; the IO above holds the encoder.
    transforms.push(draco());
  } else {
    await readyMeshopt();
    transforms.push(meshopt({ encoder: MeshoptEncoder }));
  }
  transforms.push(
    ktx2({
      isUASTC: false,
      generateMipmap: true,
      enableDebug: false,
      qualityLevel: opts.ktxQuality ?? 128,
      imageDecoder,
    }),
    prune(),
  );

  await doc.transform(...transforms);
  return io.writeBinary(doc);
}

/** Encode a standalone LDR image (PNG/JPEG) to a KTX2/Basis texture. */
export async function encodeKtx2(image: Uint8Array): Promise<Uint8Array> {
  return encodeToKTX2(image, {
    isUASTC: false,
    generateMipmap: true,
    enableDebug: false,
    imageDecoder,
  });
}

/** Read a GLB back into a Document (used by tests to verify compression survived). */
export async function readGlb(
  bytes: Uint8Array,
  codec: GeometryCodec = "meshopt",
): Promise<Document> {
  const io = await createIO({ draco: codec === "draco" });
  return io.readBinary(bytes);
}

/** One decoded interleaved PCM WAV, split into per-channel `Int16Array`s. */
export interface WavPcm {
  sampleRate: number;
  channels: number;
  samples: Int16Array[];
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i]!);
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Decode a 16-bit PCM RIFF/WAVE file (the format `sample.ts` writes) into
 * per-channel samples. Throws on anything else so the pipeline fails closed.
 */
export function decodeWavPcm16(bytes: Uint8Array): WavPcm {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let channels = 1;
  let sampleRate = 44_100;
  let bits = 16;
  let dataStart = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataStart = body;
      dataLength = Math.min(size, bytes.byteLength - body);
      break;
    }
    offset = body + size + (size % 2);
  }

  if (dataStart < 0 || bits !== 16 || channels < 1) {
    throw new Error("unsupported WAV: need 16-bit PCM with a data chunk");
  }
  const frameCount = Math.floor(dataLength / (2 * channels));
  const samples: Int16Array[] = [];
  for (let c = 0; c < channels; c += 1) samples.push(new Int16Array(frameCount));
  for (let i = 0; i < frameCount; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      samples[c]![i] = view.getInt16(dataStart + (i * channels + c) * 2, true);
    }
  }
  return { sampleRate, channels, samples };
}

/**
 * Encode 16-bit PCM WAV to MP3 (lamejs). Deterministic for a given input, so a
 * rebuild of unchanged sources yields identical bytes and therefore the same
 * content hash (#APEX-6 invariant). Runtime audio is encoded to keep the load
 * budget small (~8 KiB/s mono @ 64 kbps vs ~44 KiB/s raw WAV).
 */
export function encodeMp3(wav: Uint8Array, kbps = 64): Uint8Array {
  const { sampleRate, channels, samples } = decodeWavPcm16(wav);
  const encoder = new Mp3Encoder(channels, sampleRate, kbps);
  const chunks: Uint8Array[] = [];
  const block = 1152;
  const frameCount = samples[0]!.length;
  for (let i = 0; i < frameCount; i += block) {
    const end = Math.min(i + block, frameCount);
    const left = samples[0]!.subarray(i, end);
    const buffer =
      channels > 1 ? encoder.encodeBuffer(left, samples[1]!.subarray(i, end)) : encoder.encodeBuffer(left);
    if (buffer.length > 0) chunks.push(new Uint8Array(buffer));
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(new Uint8Array(tail));
  return concatBytes(chunks);
}
