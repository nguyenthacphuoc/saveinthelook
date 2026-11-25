import type {
  Face3DVertex,
  FaceAngleGuide,
  FaceAngleId,
  FaceComparisonResult,
  FaceScanFrame,
} from '../types';

export const FACE_ANGLE_GUIDES: FaceAngleGuide[] = [
  {
    id: 'center',
    title: 'Bước 1 · Chính diện',
    instruction: 'Nhìn thẳng vào tâm khung hình và giữ nguyên trong 1 giây.',
    targetYaw: 0,
    targetPitch: 0,
  },
  {
    id: 'left',
    title: 'Bước 2 · Quay trái',
    instruction: 'Xoay nhẹ đầu sang trái khoảng 25° để quét cấu trúc má trái.',
    targetYaw: -0.45,
    targetPitch: 0,
  },
  {
    id: 'right',
    title: 'Bước 3 · Quay phải',
    instruction: 'Xoay nhẹ đầu sang phải khoảng 25° để quét cấu trúc má phải.',
    targetYaw: 0.45,
    targetPitch: 0,
  },
  {
    id: 'up',
    title: 'Bước 4 · Ngước lên',
    instruction: 'Ngẩng nhẹ cằm lên trên để lập bản đồ sống mũi và đường hàm.',
    targetYaw: 0,
    targetPitch: 0.35,
  },
  {
    id: 'down',
    title: 'Bước 5 · Cúi nhẹ',
    instruction: 'Hơi cúi đầu xuống để hoàn tất lưới 3D vòm trán và hốc mắt.',
    targetYaw: 0,
    targetPitch: -0.35,
  },
];

export const DESCRIPTOR_SIZE = 64;
export const FACE_MATCH_THRESHOLD = 0.84;
export const GEOMETRIC_FIT_THRESHOLD = 0.80;

export function normalizeVector(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i += 1) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return Math.max(-1, Math.min(1, dot / denom));
}

/**
 * Extracts a 64-dim luminance + edge-gradient facial descriptor from an RGBA frame.
 * Focuses on the central 60% oval where the user's face sits inside the reticle.
 */
export function extractDescriptorFromRGBA(
  rgba: Uint8ClampedArray | number[],
  width: number,
  height: number,
): number[] {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    return normalizeVector(new Array(DESCRIPTOR_SIZE).fill(0.1));
  }

  const grid = 8;
  const startX = Math.floor(width * 0.22);
  const endX = Math.floor(width * 0.78);
  const startY = Math.floor(height * 0.16);
  const endY = Math.floor(height * 0.84);
  const regionW = Math.max(grid, endX - startX);
  const regionH = Math.max(grid, endY - startY);
  const cellW = regionW / grid;
  const cellH = regionH / grid;

  const raw: number[] = [];
  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      const x0 = Math.floor(startX + gx * cellW);
      const x1 = Math.min(width - 1, Math.floor(startX + (gx + 1) * cellW));
      const y0 = Math.floor(startY + gy * cellH);
      const y1 = Math.min(height - 1, Math.floor(startY + (gy + 1) * cellH));

      let lumSum = 0;
      let edgeSum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const idx = (y * width + x) * 4;
          const lum =
            0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
          lumSum += lum;

          const nextXIdx = (y * width + Math.min(width - 1, x + 2)) * 4;
          const nextLum =
            0.299 * rgba[nextXIdx] +
            0.587 * rgba[nextXIdx + 1] +
            0.114 * rgba[nextXIdx + 2];
          edgeSum += Math.abs(lum - nextLum);
          count += 1;
        }
      }
      const avgLum = count > 0 ? lumSum / count : 0;
      const avgEdge = count > 0 ? edgeSum / count : 0;
      raw.push(avgLum * 0.65 + avgEdge * 1.45);
    }
  }

  const mean = raw.reduce((acc, v) => acc + v, 0) / raw.length;
  const centered = raw.map((v) => v - mean);
  return normalizeVector(centered);
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates deterministic 64-dim facial geometry descriptor for Guided Sensor Calibration Mode
 * or for verifying mismatch rejection in security tests.
 */
export function generateCalibrationDescriptor(
  identitySeed: string,
  angle: FaceAngleId,
  jitterAmount = 0.025,
): number[] {
  const baseRng = mulberry32(hashSeed(`face_base_${identitySeed.trim().toLowerCase()}`));
  const angleOffset: Record<FaceAngleId, number> = {
    center: 0,
    left: -0.14,
    right: 0.14,
    up: 0.11,
    down: -0.11,
  };
  const jitterRng = mulberry32(
    hashSeed(`jitter_${identitySeed}_${angle}_${Math.round(jitterAmount * 1000)}`),
  );

  const vec: number[] = [];
  for (let i = 0; i < DESCRIPTOR_SIZE; i += 1) {
    const baseVal = baseRng() * 2 - 1;
    const poseBias = Math.sin((i + 1) * 0.35) * angleOffset[angle];
    const noise = (jitterRng() * 2 - 1) * jitterAmount;
    vec.push(baseVal + poseBias + noise);
  }
  return normalizeVector(vec);
}

export function generateCalibrationBundle(
  identitySeed: string,
  jitterAmount = 0.025,
  angles: FaceAngleId[] = ['center', 'left', 'right', 'up', 'down'],
): FaceScanFrame[] {
  const now = new Date().toISOString();
  return angles.map((angle) => ({
    angle,
    descriptor: generateCalibrationDescriptor(identitySeed, angle, jitterAmount),
    capturedAt: now,
    source: 'calibration',
  }));
}

/**
 * Maps a 64-dim facial descriptor onto 48 structured 3D anatomical landmarks
 * used for both Three.js 3D topology visualization and geometric comparison.
 */
export function build3DFaceLandmarks(descriptor: number[]): Face3DVertex[] {
  const d = (idx: number) => descriptor[idx % descriptor.length] ?? 0;
  const vertices: Face3DVertex[] = [];

  // 14 jawline & chin points
  for (let i = 0; i < 14; i += 1) {
    const t = i / 13;
    const theta = -Math.PI * 0.88 + t * Math.PI * 0.76;
    const jawWidth = 0.86 + d(i) * 0.16;
    const chinDepth = 0.25 + Math.cos(theta) * 0.48 + d(i + 14) * 0.12;
    vertices.push({
      x: Math.cos(theta) * jawWidth,
      y: -0.22 + Math.sin(theta) * 0.92,
      z: chinDepth,
      region: 'jaw',
    });
  }

  // 10 brow ridge points (left & right)
  for (let i = 0; i < 10; i += 1) {
    const side = i < 5 ? -1 : 1;
    const k = (i % 5) / 4;
    vertices.push({
      x: side * (0.16 + k * 0.56) + d(i + 20) * 0.05,
      y: 0.42 + Math.sin(k * Math.PI) * 0.1 + d(i + 25) * 0.06,
      z: 0.62 - k * 0.18 + d(i + 30) * 0.08,
      region: 'brow',
    });
  }

  // 8 eye orbit landmarks
  for (let i = 0; i < 8; i += 1) {
    const side = i < 4 ? -1 : 1;
    const a = ((i % 4) / 4) * Math.PI * 2;
    vertices.push({
      x: side * 0.36 + Math.cos(a) * (0.16 + d(i + 35) * 0.03),
      y: 0.22 + Math.sin(a) * (0.09 + d(i + 40) * 0.03),
      z: 0.58 + d(i + 42) * 0.06,
      region: 'eye',
    });
  }

  // 6 nose bridge & tip points
  for (let i = 0; i < 6; i += 1) {
    const t = i / 5;
    vertices.push({
      x: d(i + 45) * 0.04,
      y: 0.34 - t * 0.46,
      z: 0.66 + Math.sin(t * Math.PI * 0.75) * 0.32 + d(i + 48) * 0.09,
      region: 'nose',
    });
  }

  // 6 mouth contour points
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    vertices.push({
      x: Math.cos(a) * (0.28 + d(i + 52) * 0.05),
      y: -0.34 + Math.sin(a) * (0.09 + d(i + 54) * 0.03),
      z: 0.68 + d(i + 56) * 0.06,
      region: 'mouth',
    });
  }

  // 4 cheekbone anchors
  for (let i = 0; i < 4; i += 1) {
    const side = i < 2 ? -1 : 1;
    const row = i % 2;
    vertices.push({
      x: side * (0.52 + row * 0.16) + d(i + 58) * 0.07,
      y: 0.04 - row * 0.16,
      z: 0.54 - row * 0.12 + d(i + 60) * 0.08,
      region: 'cheek',
    });
  }

  return vertices;
}

export function averageDescriptors(frames: FaceScanFrame[]): number[] {
  if (frames.length === 0) return normalizeVector(new Array(DESCRIPTOR_SIZE).fill(0.1));
  const sum = new Array(DESCRIPTOR_SIZE).fill(0);
  for (const frame of frames) {
    for (let i = 0; i < DESCRIPTOR_SIZE; i += 1) {
      sum[i] += frame.descriptor[i] ?? 0;
    }
  }
  return normalizeVector(sum);
}

/**
 * Compares an enrolled 360-degree 5-angle biometric bundle against a live scan bundle,
 * constructing both 3D vertex clouds and calculating cosine + 3D spatial similarity.
 */
export function compare3DFaceModels(
  enrolledBundle: FaceScanFrame[],
  liveBundle: FaceScanFrame[],
): FaceComparisonResult {
  const perAngle: Array<{ angle: FaceAngleId; score: number }> = [];
  const enrolledMean = averageDescriptors(enrolledBundle);
  const liveMean = averageDescriptors(liveBundle);

  for (const liveFrame of liveBundle) {
    const matchingEnrolled = enrolledBundle.find((f) => f.angle === liveFrame.angle);
    const referenceDesc = matchingEnrolled ? matchingEnrolled.descriptor : enrolledMean;
    const rawScore = cosineSimilarity(referenceDesc, liveFrame.descriptor);
    // Map cosine similarity [-1..1] cleanly to [0..1]
    const normalizedScore = Number(((rawScore + 1) / 2).toFixed(4));
    perAngle.push({ angle: liveFrame.angle, score: normalizedScore });
  }

  const meanCosineRaw = cosineSimilarity(enrolledMean, liveMean);
  const meanCosineNormalized = (meanCosineRaw + 1) / 2;

  const angleAverage =
    perAngle.length > 0
      ? perAngle.reduce((acc, item) => acc + item.score, 0) / perAngle.length
      : meanCosineNormalized;

  const similarity = Number(
    (angleAverage * 0.65 + meanCosineNormalized * 0.35).toFixed(4),
  );

  const enrolledVertices = build3DFaceLandmarks(enrolledMean);
  const liveVertices = build3DFaceLandmarks(liveMean);

  let totalDist = 0;
  for (let i = 0; i < enrolledVertices.length; i += 1) {
    const a = enrolledVertices[i];
    const b = liveVertices[i];
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    totalDist += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  const meanVertexError = totalDist / Math.max(1, enrolledVertices.length);
  const geometricFit = Number(Math.max(0, Math.min(1, 1 - meanVertexError * 4.2)).toFixed(4));

  const matched =
    similarity >= FACE_MATCH_THRESHOLD && geometricFit >= GEOMETRIC_FIT_THRESHOLD;

  return {
    matched,
    similarity,
    geometricFit,
    threshold: FACE_MATCH_THRESHOLD,
    perAngle,
    enrolledVertices,
    liveVertices,
  };
}
