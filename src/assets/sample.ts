#!/usr/bin/env bun
/**
 * Generates the deterministic sample-stage source assets under `assets/source/`:
 *
 *   gate-arch.glb    — a start/finish gantry mesh (3 boxes) with an embedded texture
 *   tarmac.png       — a standalone ground/road texture
 *   ambient-loop.wav — a short ambient audio loop
 *
 * Deterministic: the same bytes every run, so the committed sources and their hashes
 * are reproducible. Run `bun run assets:sample` to regenerate.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import sharp from "sharp";

const ROOT = process.cwd();
const SOURCE_DIR = join(ROOT, "assets/source");

interface Box {
  center: [number, number, number];
  size: [number, number, number];
}

/** 24 vertices / 36 indices for one box (flat normals, 0..1 UV per face). */
function boxGeometry(box: Box): {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
} {
  const [cx, cy, cz] = box.center;
  const [sx, sy, sz] = box.size;
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  // Each face: 4 corners + outward normal.
  const faces: { normal: [number, number, number]; corners: [number, number, number][] }[] = [
    { normal: [0, 0, 1], corners: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { normal: [0, 0, -1], corners: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    { normal: [1, 0, 0], corners: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { normal: [-1, 0, 0], corners: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { normal: [0, 1, 0], corners: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { normal: [0, -1, 0], corners: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  faces.forEach((face, f) => {
    const base = f * 4;
    for (const [x, y, z] of face.corners) {
      positions.push(x + cx, y + cy, z + cz);
      normals.push(...face.normal);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}

async function buildGateArch(): Promise<Uint8Array> {
  const boxes: Box[] = [
    { center: [-3, 2.5, 0], size: [0.6, 5, 0.6] }, // left post
    { center: [3, 2.5, 0], size: [0.6, 5, 0.6] }, // right post
    { center: [0, 5.2, 0], size: [7, 0.6, 0.6] }, // top beam
  ];

  const doc = new Document();
  const buffer = doc.createBuffer();

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;
  for (const box of boxes) {
    const g = boxGeometry(box);
    positions.push(...g.positions);
    normals.push(...g.normals);
    uvs.push(...g.uvs);
    for (const i of g.indices) indices.push(i + vertexOffset);
    vertexOffset += g.positions.length / 3;
  }

  const primitive = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      doc.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buffer),
    )
    .setAttribute(
      "NORMAL",
      doc.createAccessor().setType("VEC3").setArray(new Float32Array(normals)).setBuffer(buffer),
    )
    .setAttribute(
      "TEXCOORD_0",
      doc.createAccessor().setType("VEC2").setArray(new Float32Array(uvs)).setBuffer(buffer),
    )
    .setIndices(
      doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(indices)).setBuffer(buffer),
    );

  const texturePng = await makeTexturePng();
  const texture = doc
    .createTexture("gantry-paint")
    .setImage(texturePng)
    .setMimeType("image/png");
  const material = doc
    .createMaterial("gantry")
    .setBaseColorTexture(texture)
    .setMetallicFactor(0.1)
    .setRoughnessFactor(0.8);
  primitive.setMaterial(material);

  doc
    .createScene("Stage")
    .addChild(doc.createNode("gate-arch").setMesh(doc.createMesh("gate-arch").addPrimitive(primitive)));

  const io = new NodeIO();
  return io.writeBinary(doc);
}

/** 128×128 RGB checker + vertical gradient, deterministic. */
async function makeTexturePng(): Promise<Uint8Array> {
  const size = 128;
  const raw = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const checker = ((x >> 4) + (y >> 4)) % 2 === 0 ? 40 : 0;
      const i = (y * size + x) * 3;
      raw[i] = 180 + checker;
      raw[i + 1] = 60 + Math.floor((y / size) * 80);
      raw[i + 2] = 70 + checker;
    }
  }
  return new Uint8Array(
    await sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer(),
  );
}

/** 0.5s, 8kHz, mono, 16-bit PCM sine — small and deterministic. */
function makeAmbientWav(): Uint8Array {
  const sampleRate = 8000;
  const seconds = 0.5;
  const count = Math.floor(sampleRate * seconds);
  const dataBytes = count * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < count; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.2 * 32767);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }
  return new Uint8Array(buffer);
}

async function main(): Promise<void> {
  mkdirSync(SOURCE_DIR, { recursive: true });
  const outputs: [string, Uint8Array][] = [
    ["gate-arch.glb", await buildGateArch()],
    ["tarmac.png", await makeTexturePng()],
    ["ambient-loop.wav", makeAmbientWav()],
  ];
  for (const [name, bytes] of outputs) {
    writeFileSync(join(SOURCE_DIR, name), bytes);
    console.log(`wrote assets/source/${name} (${bytes.byteLength} bytes)`);
  }
}

await main();
