import { Document, NodeIO, type Transform } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, draco, meshopt, prune, resample } from "@gltf-transform/functions";
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
