import { BufferGeometry, Vector3 } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export const MAX_PREVIEW_BYTES = 25_000_000;
export const MAX_PREVIEW_TRIANGLES = 100_000;
export type Triple = [number, number, number];
export type Bounds = { min: readonly [number, number, number]; max: readonly [number, number, number] };

export async function parsePreviewGeometry(bytes: ArrayBuffer, expectedSha256: string): Promise<BufferGeometry> {
  if (bytes.byteLength < 84) throw new Error('STL preview is empty or truncated.');
  if (bytes.byteLength > MAX_PREVIEW_BYTES) throw new Error('STL preview exceeds the 25 MB limit.');
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) throw new Error('STL identity requires a SHA-256 hash.');
  if (!globalThis.crypto?.subtle) throw new Error('STL integrity verification requires HTTPS or localhost.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expectedSha256.toLowerCase()) throw new Error('STL hash does not match the registered saved reference.');

  // This fixture source registers binary STL only. Validate its complete layout before STLLoader allocates.
  const data = new DataView(bytes);
  const triangles = data.getUint32(80, true);
  if (!triangles) throw new Error('STL preview contains no triangles.');
  if (triangles > MAX_PREVIEW_TRIANGLES) throw new Error('STL preview exceeds the 100,000 triangle limit.');
  if (84 + triangles * 50 !== bytes.byteLength) throw new Error('STL preview is malformed or truncated; expected binary STL.');
  for (let face = 0; face < triangles; face++) {
    for (let offset = 0; offset < 48; offset += 4) {
      if (!Number.isFinite(data.getFloat32(84 + face * 50 + offset, true))) {
        throw new Error('STL preview contains nonfinite coordinates or normals.');
      }
    }
  }

  const geometry = new STLLoader().parse(bytes);
  try {
    const position = geometry.getAttribute('position');
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (let i = 0; i < position.count; i += 3) {
      a.fromBufferAttribute(position, i);
      b.fromBufferAttribute(position, i + 1).sub(a);
      c.fromBufferAttribute(position, i + 2).sub(a);
      const area = b.cross(c).lengthSq();
      if (!Number.isFinite(area) || area === 0) throw new Error('STL preview contains an invalid triangle.');
    }
    // Recalculate shading from the original oriented faces, never transform the mm/Z-up vertices.
    geometry.computeVertexNormals();
    if (!Array.from(geometry.getAttribute('normal').array).every(Number.isFinite)) {
      throw new Error('STL preview contains invalid normals.');
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  } catch (error) {
    geometry.dispose();
    throw error;
  }
}

export function fitCameraToBounds(bounds: Bounds, aspect: number): {
  position: Triple; target: Triple; up: Triple; fov: number; near: number; far: number;
} {
  if (!Number.isFinite(aspect) || aspect <= 0 ||
    ![...bounds.min, ...bounds.max].every(Number.isFinite) ||
    bounds.min.some((value, i) => value > bounds.max[i])) throw new Error('Invalid preview bounds or viewport.');
  const min = new Vector3(...bounds.min), max = new Vector3(...bounds.max);
  const center = min.clone().add(max).multiplyScalar(0.5);
  const radius = min.distanceTo(max) / 2;
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Preview bounds are empty.');
  const fov = 40;
  const halfVertical = fov * Math.PI / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  // A padded bounding sphere fits at any camera orientation, including the named views.
  const distance = radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.15;
  const position = center.clone().add(new Vector3(1, -1, 0.9).normalize().multiplyScalar(distance));
  return {
    position: position.toArray(), target: center.toArray(), up: [0, 0, 1], fov,
    near: radius / 1000, far: distance + radius * 100,
  };
}
