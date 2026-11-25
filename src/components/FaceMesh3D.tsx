import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Face3DVertex } from '../types';
import { build3DFaceLandmarks } from '../utils/biometrics';

interface FaceMesh3DProps {
  mode: 'enroll' | 'compare' | 'idle';
  targetYaw?: number;
  targetPitch?: number;
  enrolledVertices?: Face3DVertex[];
  liveVertices?: Face3DVertex[];
  matchStatus?: 'pending' | 'matched' | 'mismatch';
  scanProgress?: number; // 0..1
}

const DEFAULT_DESCRIPTOR = Array.from({ length: 64 }, (_, i) => Math.sin(i * 0.4) * 0.2);

export function FaceMesh3D({
  mode,
  targetYaw = 0,
  targetPitch = 0,
  enrolledVertices,
  liveVertices,
  matchStatus = 'pending',
  scanProgress = 0,
}: FaceMesh3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef({
    mode,
    targetYaw,
    targetPitch,
    enrolledVertices,
    liveVertices,
    matchStatus,
    scanProgress,
  });

  propsRef.current = {
    mode,
    targetYaw,
    targetPitch,
    enrolledVertices,
    liveVertices,
    matchStatus,
    scanProgress,
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const probeCanvas = document.createElement('canvas');
        const gl = probeCanvas.getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const width = Math.max(280, container.clientWidth);
    const height = Math.max(260, container.clientHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1120);
    scene.fog = new THREE.FogExp2(0x0b1120, 0.08);

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 40);
    camera.position.set(0, 0.05, 4.1);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Warm key + cool hemisphere fill
    const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.8);
    keyLight.position.set(2.5, 3.2, 3.5);
    scene.add(keyLight);

    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.9);
    scene.add(hemiLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.1);
    rimLight.position.set(-2.5, 1.0, -3.0);
    scene.add(rimLight);

    // Root 3D Face Group (composite multi-part geometry)
    const headGroup = new THREE.Group();
    scene.add(headGroup);

    // 1. Sculpted Face Cranial Topology Shell
    const baseHeadGeo = new THREE.SphereGeometry(0.95, 28, 22);
    const posAttr = baseHeadGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i += 1) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      // Taper lower jaw and flatten temples slightly into an anatomical cranial profile
      const jawTaper = y < 0 ? 1 - Math.abs(y) * 0.24 : 1;
      const noseRidge =
        z > 0.45 && Math.abs(x) < 0.14 && y > -0.22 && y < 0.35
          ? 0.12 * Math.cos((x / 0.14) * Math.PI * 0.5)
          : 0;
      const eyeSocket =
        z > 0.5 && Math.abs(Math.abs(x) - 0.32) < 0.16 && Math.abs(y - 0.18) < 0.11
          ? -0.06
          : 0;
      posAttr.setXYZ(i, x * 0.86 * jawTaper, y * 1.16, z * 0.9 + noseRidge + eyeSocket);
    }
    baseHeadGeo.computeVertexNormals();

    const shellMaterial = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.35,
      metalness: 0.72,
      transparent: true,
      opacity: 0.68,
    });
    const shellMesh = new THREE.Mesh(baseHeadGeo, shellMaterial);
    headGroup.add(shellMesh);

    const wireGeo = new THREE.WireframeGeometry(baseHeadGeo);
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.45,
    });
    const wireMesh = new THREE.LineSegments(wireGeo, wireMat);
    headGroup.add(wireMesh);

    // 2. Outer Orbital 360 Guide Rings
    const ringGeo = new THREE.TorusGeometry(1.42, 0.012, 12, 72);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.25,
      metalness: 0.8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.4,
    });
    const yawRing = new THREE.Mesh(ringGeo, ringMat);
    yawRing.rotation.x = Math.PI * 0.5;
    scene.add(yawRing);

    const pitchRing = new THREE.Mesh(ringGeo, ringMat.clone());
    pitchRing.rotation.y = Math.PI * 0.5;
    (pitchRing.material as THREE.MeshStandardMaterial).opacity = 0.45;
    (pitchRing.material as THREE.MeshStandardMaterial).transparent = true;
    scene.add(pitchRing);

    // 3. Laser Scan Plane
    const laserGeo = new THREE.TorusGeometry(1.08, 0.014, 10, 64);
    const laserMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x06b6d4,
      emissiveIntensity: 1.2,
      roughness: 0.2,
      metalness: 0.3,
    });
    const laserRing = new THREE.Mesh(laserGeo, laserMat);
    laserRing.rotation.x = Math.PI * 0.5;
    headGroup.add(laserRing);

    // 4. Enrolled Landmark Nodes (48 InstancedMesh points)
    const fallbackVerts = build3DFaceLandmarks(DEFAULT_DESCRIPTOR);
    const nodeCount = fallbackVerts.length;
    const nodeGeo = new THREE.SphereGeometry(0.028, 10, 10);
    const enrolledMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0.4,
    });
    const enrolledNodes = new THREE.InstancedMesh(nodeGeo, enrolledMat, nodeCount);
    enrolledNodes.frustumCulled = false;
    headGroup.add(enrolledNodes);

    // 5. Live Comparison Landmark Nodes (48 InstancedMesh points)
    const liveMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 1.0,
      roughness: 0.2,
      metalness: 0.4,
    });
    const liveNodes = new THREE.InstancedMesh(nodeGeo, liveMat, nodeCount);
    liveNodes.frustumCulled = false;
    headGroup.add(liveNodes);

    // Reusable scratch helpers outside loop
    const _dummy = new THREE.Object3D();
    let lastTime = performance.now();
    const startTime = lastTime;
    let frameId = 0;
    let disposed = false;

    const updateNodes = (
      instanced: THREE.InstancedMesh,
      verts: Face3DVertex[],
      scaleOffset = 1,
      nodeScale = 1,
    ) => {
      for (let i = 0; i < nodeCount; i += 1) {
        const v = verts[i] || fallbackVerts[i];
        _dummy.position.set(v.x * scaleOffset, v.y * scaleOffset, v.z * scaleOffset);
        _dummy.scale.setScalar(nodeScale);
        _dummy.updateMatrix();
        instanced.setMatrixAt(i, _dummy.matrix);
      }
      instanced.instanceMatrix.needsUpdate = true;
    };

    updateNodes(enrolledNodes, fallbackVerts, 1, 1);
    liveNodes.visible = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const now = performance.now();
      const delta = Math.min(0.1, (now - lastTime) / 1000);
      const elapsed = (now - startTime) / 1000;
      lastTime = now;
      const state = propsRef.current;

      // Update colors and vertices based on mode
      const enrolledSrc = state.enrolledVertices?.length
        ? state.enrolledVertices
        : fallbackVerts;
      updateNodes(enrolledNodes, enrolledSrc, 1.0, 1.0);

      if (state.mode === 'compare' && state.liveVertices?.length) {
        liveNodes.visible = true;
        if (state.matchStatus === 'matched') {
          updateNodes(liveNodes, state.liveVertices, 1.04, 1.15);
          liveMat.color.setHex(0x10b981);
          liveMat.emissive.setHex(0x10b981);
          wireMat.color.setHex(0x10b981);
          laserMat.color.setHex(0x10b981);
          laserMat.emissive.setHex(0x059669);
        } else if (state.matchStatus === 'mismatch') {
          updateNodes(liveNodes, state.liveVertices, 1.08, 1.35);
          liveMat.color.setHex(0xef4444);
          liveMat.emissive.setHex(0xef4444);
          wireMat.color.setHex(0xef4444);
          laserMat.color.setHex(0xef4444);
          laserMat.emissive.setHex(0xdc2626);
        } else {
          updateNodes(liveNodes, state.liveVertices, 1.04, 1.1);
          liveMat.color.setHex(0xf59e0b);
          liveMat.emissive.setHex(0xd97706);
          wireMat.color.setHex(0x38bdf8);
          laserMat.color.setHex(0x22d3ee);
          laserMat.emissive.setHex(0x06b6d4);
        }
      } else {
        liveNodes.visible = false;
        wireMat.color.setHex(0x38bdf8);
        laserMat.color.setHex(0x22d3ee);
        laserMat.emissive.setHex(0x06b6d4);
      }

      // Smooth exponential damping toward guided pose or 360 comparison spin
      if (state.mode === 'enroll') {
        headGroup.rotation.y = THREE.MathUtils.damp(
          headGroup.rotation.y,
          state.targetYaw,
          5,
          delta,
        );
        headGroup.rotation.x = THREE.MathUtils.damp(
          headGroup.rotation.x,
          -state.targetPitch,
          5,
          delta,
        );
      } else {
        const targetRotY = Math.sin(elapsed * 0.75) * 0.55;
        headGroup.rotation.y = THREE.MathUtils.damp(
          headGroup.rotation.y,
          targetRotY,
          4,
          delta,
        );
        headGroup.rotation.x = THREE.MathUtils.damp(headGroup.rotation.x, 0.04, 4, delta);
      }

      // Vertical laser scan sweep
      laserRing.position.y = Math.sin(elapsed * 2.1) * 0.85;
      const scalePulse = 1 + Math.sin(elapsed * 2.1) * 0.04;
      laserRing.scale.set(scalePulse, scalePulse, 1);

      // Subtle guide ring drift
      yawRing.rotation.z = elapsed * 0.25;
      pitchRing.rotation.x = elapsed * 0.18;

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }
    tick();

    const handleResize = () => {
      if (!container || disposed) return;
      const w = Math.max(280, container.clientWidth);
      const h = Math.max(260, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);

      baseHeadGeo.dispose();
      shellMaterial.dispose();
      wireGeo.dispose();
      wireMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      laserGeo.dispose();
      laserMat.dispose();
      nodeGeo.dispose();
      enrolledMat.dispose();
      liveMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      data-testid="face-mesh-3d"
      data-mode={mode}
      data-match={matchStatus}
      className="relative h-full w-full min-h-[280px] overflow-hidden rounded-xl border border-slate-800 bg-[#0B1120]"
    >
      <div ref={mountRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-x-4 bottom-3 flex items-center justify-between text-xs text-slate-300">
        <span className="rounded bg-slate-950/90 px-2.5 py-1 border border-slate-800">
          {mode === 'enroll'
            ? `Lưới sinh trắc 360° · ${Math.round(scanProgress * 100)}%`
            : mode === 'compare'
              ? matchStatus === 'matched'
                ? 'Khớp mô hình 3D hợp lệ'
                : matchStatus === 'mismatch'
                  ? 'Sai lệch hình học 3D'
                  : 'Đang đối chiếu 48 điểm 3D'
              : 'Mô hình 3D sẵn sàng'}
        </span>
        {mode === 'compare' && (
          <span className="rounded bg-slate-950/90 px-2.5 py-1 border border-slate-800 font-mono tabular-nums">
            Cyan: Mẫu gốc · {matchStatus === 'mismatch' ? 'Đỏ' : 'Lục'}: Quét mới
          </span>
        )}
      </div>
    </div>
  );
}
