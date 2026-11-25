import test from 'node:test';
import assert from 'node:assert/strict';
import {
  build3DFaceLandmarks,
  compare3DFaceModels,
  extractDescriptorFromRGBA,
  generateCalibrationBundle,
} from './biometrics';

test('same identity calibration bundle passes 3D Face ID comparison', () => {
  const enrolled = generateCalibrationBundle('minh_nguyen', 0.02);
  const live = generateCalibrationBundle('minh_nguyen', 0.03, ['center', 'left']);

  const result = compare3DFaceModels(enrolled, live);
  assert.equal(result.matched, true);
  assert.ok(result.similarity >= 0.84, `Expected similarity >= 0.84, got ${result.similarity}`);
  assert.ok(result.geometricFit >= 0.8, `Expected geometricFit >= 0.80, got ${result.geometricFit}`);
  assert.equal(result.enrolledVertices.length, 48);
  assert.equal(result.liveVertices.length, 48);
});

test('different identity calibration bundle is rejected by 3D Face ID comparison', () => {
  const enrolled = generateCalibrationBundle('minh_nguyen', 0.02);
  const intruder = generateCalibrationBundle('other_person_xyz', 0.02, ['center', 'left']);

  const result = compare3DFaceModels(enrolled, intruder);
  assert.equal(result.matched, false);
  assert.ok(result.similarity < 0.84, `Expected mismatch similarity < 0.84, got ${result.similarity}`);
});

test('extractDescriptorFromRGBA yields normalized 64-dim vector and build3DFaceLandmarks creates 48 points', () => {
  const width = 64;
  const height = 64;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      rgba[i] = (x * 4) % 255;
      rgba[i + 1] = (y * 4) % 255;
      rgba[i + 2] = ((x + y) * 2) % 255;
      rgba[i + 3] = 255;
    }
  }
  const desc = extractDescriptorFromRGBA(rgba, width, height);
  assert.equal(desc.length, 64);
  const norm = Math.sqrt(desc.reduce((acc, v) => acc + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 0.01, `Expected unit vector norm ~1, got ${norm}`);

  const vertices = build3DFaceLandmarks(desc);
  assert.equal(vertices.length, 48);
});
