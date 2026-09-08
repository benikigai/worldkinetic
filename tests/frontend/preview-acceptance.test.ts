// OUTSIDE_WRAPPER: supervisor acceptance bootstrap for the real STL viewer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { parsePreviewGeometry, fitCameraToBounds } from '../../src/client/workspace/preview.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const buffer = (bytes: Buffer) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const root = new URL('../../', import.meta.url);
const face = (points: number[][]) => {
  const vertices = points.map((point) => point.join(','));
  return [0, 1, 2].map((offset) => [...vertices.slice(offset), ...vertices.slice(0, offset)].join('|')).sort()[0];
};

for (const [file, expectedHash, size] of [
  ['original/mcp-test-plate.stl', 'e078a52ece47d126ca7a22d19070e73d170b709f14847359e94252379f0ed76c', [40, 30, 8]],
  ['revised/plate-50x35x5.stl', 'be0f4113c8b12339f37d7a34cbb1b967b22fae6c13bbcabd156a591480dc2d4a', [50, 35, 5]],
] as const) {
  test(`preview preserves the measured mm/Z-up coordinates of ${file}`, async () => {
    const bytes = await readFile(new URL(`examples/plate/${file}`, root));
    assert.equal(hash(bytes), expectedHash, 'The trusted reference bytes changed');
    const geometry = await parsePreviewGeometry(buffer(bytes), expectedHash);
    geometry.computeBoundingBox();
    assert.deepEqual(geometry.boundingBox?.min.toArray(), [0, 0, 0]);
    assert.deepEqual(geometry.boundingBox?.max.toArray(), [...size]);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    assert.ok([...position.array, ...normal.array].every(Number.isFinite));
    const expectedFaces: string[] = [];
    for (let i = 0; i < bytes.readUInt32LE(80); i++) {
      expectedFaces.push(face([0, 1, 2].map((vertex) => [0, 1, 2].map((axis) => bytes.readFloatLE(84 + i * 50 + 12 + vertex * 12 + axis * 4)))));
    }
    const actualFaces: string[] = [];
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    assert.equal(count, expectedFaces.length * 3);
    for (let i = 0; i < count; i += 3) {
      actualFaces.push(face([0, 1, 2].map((vertex) => {
        const offset = index ? index.getX(i + vertex) : i + vertex;
        return [position.getX(offset), position.getY(offset), position.getZ(offset)];
      })));
    }
    assert.deepEqual(actualFaces.sort(), expectedFaces.sort(), 'Preview must preserve every oriented face, including both holes');
    geometry.dispose();
  });
}

test('preview rejects a registered hash mismatch instead of showing other geometry', async () => {
  const bytes = await readFile(new URL('examples/plate/revised/plate-50x35x5.stl', root));
  await assert.rejects(parsePreviewGeometry(buffer(bytes), 'e078a52ece47d126ca7a22d19070e73d170b709f14847359e94252379f0ed76c'), /hash|integrity|match/i);
});

test('preview rejects empty, truncated and nonfinite geometry even with matching hashes', async () => {
  const bytes = await readFile(new URL('examples/plate/revised/plate-50x35x5.stl', root));
  const empty = Buffer.alloc(84);
  const truncated = bytes.subarray(0, 110);
  const nonfinite = Buffer.from(bytes);
  nonfinite.writeFloatLE(NaN, 96);
  for (const invalid of [empty, truncated, nonfinite]) {
    await assert.rejects(parsePreviewGeometry(buffer(invalid), hash(invalid)));
  }
});

test('camera fits every bounds corner in wide and narrow viewports without changing world coordinates', () => {
  for (const bounds of [
    { min: [0, 0, 0], max: [50, 35, 5] },
    { min: [-10, 20, 5], max: [40, 55, 10] },
  ] as const) for (const aspect of [16 / 9, 0.55]) {
    const settings = fitCameraToBounds(bounds, aspect);
    assert.deepEqual(settings.target, bounds.min.map((n, i) => (n + bounds.max[i]) / 2));
    assert.deepEqual(settings.up, [0, 0, 1]);
    assert.ok(settings.position.every(Number.isFinite));
    assert.ok(settings.position[2] > bounds.max[2]);
    assert.ok(settings.fov >= 20 && settings.fov <= 75);
    assert.ok(settings.near > 0 && settings.far > settings.near);
    const camera = new PerspectiveCamera(settings.fov, aspect, settings.near, settings.far);
    camera.position.set(...settings.position);
    camera.up.set(...settings.up);
    camera.lookAt(...settings.target);
    camera.updateMatrixWorld(true);
    for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
      const point = new Vector3(x, y, z).project(camera);
      assert.ok(point.toArray().every(Number.isFinite));
      assert.ok(Math.abs(point.x) <= 0.95 && Math.abs(point.y) <= 0.95, 'All corners need visible padding');
      assert.ok(point.z > -1 && point.z < 1, 'Near/far clipping must retain the whole object');
    }
  }
});
