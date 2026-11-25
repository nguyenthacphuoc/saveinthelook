import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Camera,
  CheckCircle2,
  KeyRound,
  RotateCcw,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import type {
  AuthUser,
  Face3DVertex,
  FaceComparisonResult,
  FaceScanFrame,
} from '../types';
import {
  FACE_ANGLE_GUIDES,
  build3DFaceLandmarks,
  extractDescriptorFromRGBA,
  generateCalibrationBundle,
  generateCalibrationDescriptor,
} from '../utils/biometrics';
import { FaceMesh3D } from './FaceMesh3D';

interface FaceAuthGatewayProps {
  user: AuthUser | null;
  onAuthenticated: (params: {
    token: string;
    user: AuthUser;
    passphrase: string;
  }) => void;
  onGoToVault: () => void;
}

export function FaceAuthGateway({
  user,
  onAuthenticated,
  onGoToVault,
}: FaceAuthGatewayProps) {
  const [authTab, setAuthTab] = useState<'register' | 'login'>('register');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [passphrase, setPassphrase] = useState('');

  // Camera & Sensor Calibration state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<string>(
    'Sẵn sàng kết nối camera hoặc chế độ hiệu chuẩn cảm biến',
  );

  // 360 Enrollment state
  const [stepIndex, setStepIndex] = useState(0);
  const [enrolledFrames, setEnrolledFrames] = useState<FaceScanFrame[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Login 3D Comparison state
  const [comparison, setComparison] = useState<FaceComparisonResult | null>(null);
  const [livePreviewVerts, setLivePreviewVerts] = useState<Face3DVertex[] | undefined>(
    undefined,
  );

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setErrorMsg(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus(
        'Trình duyệt không hỗ trợ camera trực tiếp. Bạn có thể dùng Hiệu chuẩn Cảm biến 360°.',
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setCameraStatus('Camera đang hoạt động · Giữ khuôn mặt trong khung oval');
    } catch {
      setCameraActive(false);
      setCameraStatus(
        'Không phát hiện webcam hoặc quyền camera bị từ chối. Hãy dùng Hiệu chuẩn Cảm biến 360° bên dưới.',
      );
    }
  };

  const captureFromVideoOrCalibration = (
    angleIndex: number,
    calibrationIdentity: string,
    jitter = 0.02,
  ): FaceScanFrame => {
    const guide = FACE_ANGLE_GUIDES[angleIndex] || FACE_ANGLE_GUIDES[0];

    if (cameraActive && videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const w = 128;
      const h = 128;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx && video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const desc = extractDescriptorFromRGBA(imageData.data, w, h);
        return {
          angle: guide.id,
          descriptor: desc,
          capturedAt: new Date().toISOString(),
          source: 'camera',
        };
      }
    }

    const seed = calibrationIdentity.trim() || 'demo_user';
    return {
      angle: guide.id,
      descriptor: generateCalibrationDescriptor(seed, guide.id, jitter),
      capturedAt: new Date().toISOString(),
      source: 'calibration',
    };
  };

  const handleCaptureAngle = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!username.trim()) {
      setErrorMsg('Vui lòng nhập tên tài khoản trước khi quét Face ID 360°.');
      return;
    }

    const frame = captureFromVideoOrCalibration(stepIndex, username, 0.018);
    const updated = [
      ...enrolledFrames.filter((f) => f.angle !== frame.angle),
      frame,
    ];
    setEnrolledFrames(updated);
    setLivePreviewVerts(build3DFaceLandmarks(frame.descriptor));

    if (stepIndex < FACE_ANGLE_GUIDES.length - 1) {
      setStepIndex((prev) => prev + 1);
    }
  };

  const handleResetScan = () => {
    setEnrolledFrames([]);
    setStepIndex(0);
    setLivePreviewVerts(undefined);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (username.trim().length < 3) {
      setErrorMsg('Tên tài khoản cần ít nhất 3 ký tự.');
      return;
    }
    if (passphrase.length < 6) {
      setErrorMsg('Mật khẩu mã hóa AES-256 cần ít nhất 6 ký tự.');
      return;
    }
    if (enrolledFrames.length < 5) {
      setErrorMsg('Vui lòng hoàn tất quét đủ 5 góc Face ID 360° trước khi tạo tài khoản.');
      return;
    }

    setBusy(true);
    try {
      const resp = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          displayName: displayName.trim() || username.trim(),
          passphrase,
          enrolledBundle: enrolledFrames,
        }),
      });
      const data = (await resp.json()) as {
        token?: string;
        user?: AuthUser;
        error?: string;
      };
      if (!resp.ok || !data.token || !data.user) {
        setErrorMsg(data.error || 'Không thể đăng ký tài khoản.');
        return;
      }
      stopCamera();
      setSuccessMsg('Đã tạo tài khoản và lưu mô hình Face ID 3D an toàn.');
      onAuthenticated({ token: data.token, user: data.user, passphrase });
    } catch {
      setErrorMsg('Lỗi kết nối máy chủ khi tạo tài khoản.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyFaceLogin = async (simulateMismatch = false) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setComparison(null);

    const targetUsername = username.trim().toLowerCase();
    if (!targetUsername) {
      setErrorMsg('Vui lòng nhập tên tài khoản để đối chiếu mô hình 3D.');
      return;
    }

    setBusy(true);
    try {
      // Build 2-angle live face capture (center + left) from webcam or sensor calibration
      const liveBundle: FaceScanFrame[] = cameraActive
        ? [
            captureFromVideoOrCalibration(0, targetUsername, 0.025),
            captureFromVideoOrCalibration(1, targetUsername, 0.025),
          ]
        : generateCalibrationBundle(
            simulateMismatch ? `${targetUsername}__mismatch_intruder` : targetUsername,
            0.028,
            ['center', 'left'],
          );

      const resp = await fetch('/api/auth/verify-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: targetUsername,
          passphrase: passphrase || undefined,
          liveBundle,
        }),
      });

      const data = (await resp.json()) as {
        token?: string;
        user?: AuthUser;
        comparison?: FaceComparisonResult;
        error?: string;
      };

      if (data.comparison) {
        setComparison(data.comparison);
        setLivePreviewVerts(data.comparison.liveVertices);
      }

      if (!resp.ok || !data.token || !data.user) {
        setErrorMsg(data.error || 'Xác thực khuôn mặt 3D không khớp.');
        return;
      }

      setSuccessMsg(
        `Khớp mô hình 3D thành công (${(data.comparison!.similarity * 100).toFixed(1)}%). Đang mở khóa kho lưu trữ...`,
      );
      stopCamera();
      window.setTimeout(() => {
        onAuthenticated({
          token: data.token!,
          user: data.user!,
          passphrase: passphrase || 'aegis-biometric-session',
        });
      }, 950);
    } catch {
      setErrorMsg('Không thể kết nối máy chủ xác thực.');
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
        <div className="grid gap-8 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-6 rounded-xl border border-slate-800 bg-slate-900/60 p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>Danh tính 3D đã xác thực · AES-256-GCM</span>
              </div>
              <h1 className="font-display mt-3 text-2xl font-bold text-slate-50">
                {user.displayName}
              </h1>
              <p className="mt-1 text-sm text-slate-400 font-mono">
                @{user.username} · Dấu vân sinh trắc {user.biometricFingerprint}
              </p>

              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-800 pt-5 text-sm">
                <div>
                  <dt className="text-xs text-slate-400">Góc quét 360° đã lưu</dt>
                  <dd className="mt-1 font-mono font-semibold text-slate-100 tabular-nums">
                    {user.faceEnrolledAngles} / 5 góc chuẩn
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">GitHub Đồng bộ</dt>
                  <dd className="mt-1 font-mono text-slate-100 truncate">
                    {user.githubConfig.owner && user.githubConfig.repo
                      ? `${user.githubConfig.owner}/${user.githubConfig.repo}`
                      : 'Chưa liên kết'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onGoToVault}
                className="rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400 whitespace-nowrap"
              >
                Mở Kho Lưu Trữ
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 min-h-[340px]">
            <FaceMesh3D
              mode="compare"
              enrolledVertices={comparison?.enrolledVertices}
              liveVertices={comparison?.liveVertices}
              matchStatus="matched"
            />
          </div>
        </div>
      </section>
    );
  }

  const currentGuide = FACE_ANGLE_GUIDES[stepIndex] || FACE_ANGLE_GUIDES[0];
  const enrollProgress = enrolledFrames.length / FACE_ANGLE_GUIDES.length;

  return (
    <section className="mx-auto max-w-[1320px] px-4 py-8 sm:px-8">
      <div className="grid gap-8 lg:grid-cols-12 items-stretch">
        {/* Left Column: Account Form & 360 Guided Scanner */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="lg:col-span-6 rounded-xl border border-slate-800 bg-[#0F1624] p-6 sm:p-8 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-5">
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-50 text-balance">
                  {authTab === 'register'
                    ? 'Tạo tài khoản & Quét Face ID 360°'
                    : 'Đăng nhập bằng đối chiếu 3D'}
                </h1>
                <p className="mt-1.5 text-sm text-slate-400">
                  {authTab === 'register'
                    ? 'Thu thập 5 góc khuôn mặt tạo mô hình 3D và khóa mã hóa AES-256-GCM.'
                    : 'Quét khuôn mặt để dựng lại mô hình 3D và so sánh trực tiếp với bản gốc.'}
                </p>
              </div>
            </div>

            {/* Segmented Mode Tabs */}
            <div
              role="tablist"
              aria-label="Chế độ xác thực"
              className="mt-5 grid grid-cols-2 gap-1 rounded-lg bg-slate-900 p-1 border border-slate-800"
            >
              <button
                type="button"
                role="tab"
                aria-selected={authTab === 'register'}
                onClick={() => {
                  setAuthTab('register');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                  setComparison(null);
                }}
                className={`rounded-md px-2 sm:px-3 py-2 text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap truncate ${
                  authTab === 'register'
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                Tạo tài khoản 360°
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authTab === 'login'}
                onClick={() => {
                  setAuthTab('login');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className={`rounded-md px-2 sm:px-3 py-2 text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap truncate ${
                  authTab === 'login'
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                Đăng nhập 3D
              </button>
            </div>

            <form onSubmit={handleRegisterSubmit} className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="auth-username"
                    className="block text-xs font-medium text-slate-300"
                  >
                    Tên tài khoản
                  </label>
                  <input
                    id="auth-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="vd: minh_dev"
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                    required
                  />
                </div>

                {authTab === 'register' ? (
                  <div>
                    <label
                      htmlFor="auth-displayname"
                      className="block text-xs font-medium text-slate-300"
                    >
                      Tên hiển thị cộng đồng
                    </label>
                    <input
                      id="auth-displayname"
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="vd: Trần Quang Minh"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div>
                    <label
                      htmlFor="auth-passphrase"
                      className="block text-xs font-medium text-slate-300"
                    >
                      Mật khẩu giải mã AES-256 (tùy chọn)
                    </label>
                    <input
                      id="auth-passphrase"
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Nhập để tự giải mã ghi chú riêng"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {authTab === 'register' && (
                <div>
                  <label
                    htmlFor="auth-reg-pass"
                    className="block text-xs font-medium text-slate-300"
                  >
                    Mật khẩu khóa mã hóa AES-256-GCM
                  </label>
                  <div className="relative mt-1.5">
                    <KeyRound
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-reg-pass"
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Tối thiểu 6 ký tự bảo vệ dữ liệu"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-10 pr-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                      required
                    />
                  </div>
                </div>
              )}

              {/* Camera & Guided Biometric Reticle */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                    <Camera className="h-4 w-4 text-sky-400" aria-hidden="true" />
                    <span>{cameraStatus}</span>
                  </div>
                  <button
                    type="button"
                    onClick={cameraActive ? stopCamera : startCamera}
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-sky-500/60 hover:text-white whitespace-nowrap"
                  >
                    {cameraActive ? 'Tắt Camera' : 'Bật Camera thật'}
                  </button>
                </div>

                <div className="mt-3 grid gap-4 sm:grid-cols-12 items-center">
                  {/* Live Video / Biometric Reticle */}
                  <div className="sm:col-span-5 relative aspect-square max-h-[175px] mx-auto w-full overflow-hidden rounded-xl border border-slate-800 bg-[#070B12] flex items-center justify-center">
                    <video
                      ref={videoRef}
                      muted
                      playsInline
                      className={`h-full w-full object-cover ${cameraActive ? 'opacity-100' : 'opacity-0 absolute'}`}
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Animated 360 Face Reticle SVG */}
                    <svg
                      viewBox="0 0 120 120"
                      className="relative z-10 h-32 w-32"
                      aria-hidden="true"
                    >
                      <circle
                        cx="60"
                        cy="60"
                        r="50"
                        fill="none"
                        stroke="rgba(56,189,248,0.22)"
                        strokeWidth="3"
                      />
                      <motion.circle
                        cx="60"
                        cy="60"
                        r="50"
                        fill="none"
                        stroke="#38BDF8"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeDasharray={314}
                        animate={{
                          strokeDashoffset:
                            authTab === 'register'
                              ? 314 * (1 - enrollProgress)
                              : comparison?.matched
                                ? 0
                                : 157,
                        }}
                        transition={{ duration: 0.45, ease: 'easeOut' }}
                        transform="rotate(-90 60 60)"
                      />
                      <ellipse
                        cx="60"
                        cy="60"
                        rx="26"
                        ry="34"
                        fill="none"
                        stroke={
                          comparison?.matched
                            ? '#10B981'
                            : comparison && !comparison.matched
                              ? '#EF4444'
                              : 'rgba(148,163,184,0.45)'
                        }
                        strokeDasharray="4 4"
                        strokeWidth="1.5"
                      />
                    </svg>
                    {!cameraActive && (
                      <span className="absolute bottom-2 text-[11px] font-mono text-slate-400">
                        Cảm biến hiệu chuẩn 3D
                      </span>
                    )}
                  </div>

                  {/* Step Guidance / Comparison Actions */}
                  <div className="sm:col-span-7 space-y-3">
                    {authTab === 'register' ? (
                      <>
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span className="font-semibold text-sky-400">
                            {currentGuide.title}
                          </span>
                          <span className="font-mono tabular-nums">
                            {enrolledFrames.length}/5 góc
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-slate-300">
                          {currentGuide.instruction}
                        </p>

                        {/* 5-angle checklist */}
                        <div className="grid grid-cols-5 gap-1.5">
                          {FACE_ANGLE_GUIDES.map((g, idx) => {
                            const done = enrolledFrames.some((f) => f.angle === g.id);
                            const current = idx === stepIndex;
                            return (
                              <button
                                key={g.id}
                                type="button"
                                onClick={() => setStepIndex(idx)}
                                className={`rounded-md py-1.5 text-[11px] font-medium border transition-colors ${
                                  done
                                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                                    : current
                                      ? 'border-sky-400 bg-sky-500/15 text-sky-300'
                                      : 'border-slate-800 bg-slate-900 text-slate-500'
                                }`}
                              >
                                {g.id === 'center'
                                  ? 'Thẳng'
                                  : g.id === 'left'
                                    ? 'Trái'
                                    : g.id === 'right'
                                      ? 'Phải'
                                      : g.id === 'up'
                                        ? 'Ngước'
                                        : 'Cúi'}
                              </button>
                            );
                          })}
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={handleCaptureAngle}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-800 border border-sky-500/50 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/15 transition-colors whitespace-nowrap"
                          >
                            <ScanFace className="h-4 w-4" aria-hidden="true" />
                            <span>
                              {enrolledFrames.length >= 5
                                ? 'Quét lại góc này'
                                : `Quét góc ${stepIndex + 1}/5`}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={handleResetScan}
                            aria-label="Đặt lại quá trình quét 360"
                            className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-400 hover:text-white"
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-xs leading-relaxed text-slate-300">
                          Hệ thống sẽ quét khuôn mặt của bạn, dựng mô hình lưới 3D gồm 48
                          điểm giải phẫu và đối chiếu sai số hình học với tài khoản{' '}
                          <span className="font-mono text-sky-300">
                            {username.trim() || '...'}
                          </span>
                          .
                        </p>
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleVerifyFaceLogin(false)}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-60"
                          >
                            <UserCheck className="h-4 w-4" aria-hidden="true" />
                            <span>
                              {busy ? 'Đang dựng mô hình 3D...' : 'Quét Face & So khớp 3D'}
                            </span>
                          </button>
                          {!cameraActive && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleVerifyFaceLogin(true)}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:border-rose-500/50 hover:text-rose-300 transition-colors"
                            >
                              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Thử khuôn mặt khác (Kiểm tra từ chối 3D)</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {errorMsg && (
                  <motion.div
                    key="err"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    role="alert"
                    className="rounded-lg border border-rose-500/40 bg-rose-950/50 px-3.5 py-2.5 text-xs text-rose-200 flex items-center gap-2"
                  >
                    <ShieldAlert className="h-4 w-4 text-rose-400 shrink-0" aria-hidden="true" />
                    <span>{errorMsg}</span>
                  </motion.div>
                )}
                {successMsg && (
                  <motion.div
                    key="ok"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-950/50 px-3.5 py-2.5 text-xs text-emerald-200 flex items-center gap-2"
                  >
                    <CheckCircle2
                      className="h-4 w-4 text-emerald-400 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{successMsg}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {authTab === 'register' && (
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-60"
                >
                  {busy
                    ? 'Đang mã hóa & lưu hồ sơ 3D...'
                    : 'Hoàn tất đăng ký & Mở khóa kho lưu trữ'}
                </button>
              )}
            </form>
          </div>
        </motion.div>

        {/* Right Column: Live 3D Face Topology & Biometric Comparison Viewport */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="lg:col-span-6 flex flex-col gap-4"
        >
          <div className="flex-1 min-h-[380px]">
            <FaceMesh3D
              mode={authTab === 'register' ? 'enroll' : 'compare'}
              targetYaw={currentGuide.targetYaw}
              targetPitch={currentGuide.targetPitch}
              enrolledVertices={
                comparison?.enrolledVertices || livePreviewVerts
              }
              liveVertices={comparison?.liveVertices}
              matchStatus={
                comparison
                  ? comparison.matched
                    ? 'matched'
                    : 'mismatch'
                  : 'pending'
              }
              scanProgress={enrollProgress}
            />
          </div>

          {/* 3D Biometric Telemetry Comparison Breakdown */}
          <div className="rounded-xl border border-slate-800 bg-[#0F1624] p-5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-200">
                Thông số so khớp mô hình sinh trắc 3D
              </span>
              <span className="font-mono tabular-nums">
                Ngưỡng chuẩn: 84.0%
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-800 pt-4">
              <div>
                <div className="text-xs text-slate-400">Độ tương đồng vector</div>
                <div
                  className={`mt-1 font-mono text-lg font-bold tabular-nums ${
                    comparison
                      ? comparison.matched
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                      : 'text-slate-200'
                  }`}
                >
                  {comparison ? `${(comparison.similarity * 100).toFixed(1)}%` : '--'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Khớp hình học 3D</div>
                <div className="mt-1 font-mono text-lg font-bold text-slate-200 tabular-nums">
                  {comparison ? `${(comparison.geometricFit * 100).toFixed(1)}%` : '--'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Mã hóa lưu trữ</div>
                <div className="mt-1 font-mono text-sm font-semibold text-sky-400">
                  AES-256-GCM
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
