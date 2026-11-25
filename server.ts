import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import type {
  AuthUser,
  CommunityPost,
  FaceScanFrame,
  GitHubConfigSummary,
  VaultFileRecord,
  VaultFileType,
  WebhookConfigSummary,
  WebhookDeliveryLog,
} from './src/types.ts';
import { compare3DFaceModels } from './src/utils/biometrics.ts';
import { generateGitHubPagesWorkflow, sanitizeRepoPath } from './src/utils/githubDeploy.ts';

interface StoredUser {
  username: string;
  displayName: string;
  passphraseHash: string;
  passphraseSalt: string;
  encryptedBiometricBundle: {
    ciphertext: string;
    iv: string;
    tag: string;
  };
  biometricFingerprint: string;
  faceEnrolledAngles: number;
  createdAt: string;
  githubConfig: {
    owner: string;
    repo: string;
    branch: string;
    folder: string;
    token: string;
  };
  webhookConfig: {
    webhookUrl: string;
    secret: string;
    autoDispatchOnSave: boolean;
    format: 'json' | 'discord';
  };
}

interface StoreSchema {
  users: Record<string, StoredUser>;
  files: VaultFileRecord[];
  community: CommunityPost[];
  webhookLogs: WebhookDeliveryLog[];
  webhookInbox: Array<{
    id: string;
    receivedAt: string;
    event: string;
    signature: string;
    payload: Record<string, unknown>;
  }>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'aegis_store.json');

const SESSION_SIGNING_KEY =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SERVER_STORAGE_KEY = crypto
  .createHash('sha256')
  .update(process.env.VAULT_SERVER_KEY || SESSION_SIGNING_KEY)
  .digest();

const sessions = new Map<string, { username: string; expiresAt: number }>();

function sealServerJson(data: unknown): { ciphertext: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SERVER_STORAGE_KEY, iv);
  const json = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function unsealServerJson<T>(sealed: {
  ciphertext: string;
  iv: string;
  tag: string;
}): T | null {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      SERVER_STORAGE_KEY,
      Buffer.from(sealed.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  } catch {
    return null;
  }
}

function hashPassphrase(passphrase: string, salt: string): string {
  return crypto.scryptSync(passphrase, salt, 64).toString('hex');
}

function createSessionToken(username: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    username,
    expiresAt: Date.now() + 1000 * 60 * 60 * 12,
  });
  return token;
}

function createInitialStore(): StoreSchema {
  const now = new Date().toISOString();
  const samplePy = `import hashlib
import os
from dataclasses import dataclass

@dataclass
class BiometricNode:
    x: float
    y: float
    z: float

def verify_integrity(payload: bytes, expected_sha256: str) -> bool:
    digest = hashlib.sha256(payload).hexdigest()
    return digest == expected_sha256

if __name__ == "__main__":
    sample = b"AegisVault encrypted Python snippet"
    print("SHA-256:", hashlib.sha256(sample).hexdigest())
`;

  const sampleMd = `# Kiến trúc bảo mật AegisVault

Tài liệu tóm tắt quy trình mã hóa và đồng bộ dữ liệu:

1. **Sinh trắc học 360°**: Thu thập 5 góc khuôn mặt (chính diện, trái, phải, ngước, cúi) tạo vector đặc trưng 64 chiều.
2. **So khớp mô hình 3D**: Khởi tạo lưới 48 đỉnh không gian 3D và kiểm tra độ tương đồng cosine cùng sai số hình học.
3. **Mã hóa AES-256-GCM**: Nội dung tệp được mã hóa bằng khóa dẫn xuất PBKDF2-SHA256 trước khi lưu trữ.
4. **Webhook & GitHub**: Mỗi lần lưu tệp sẽ đẩy trực tiếp bản ghi qua Webhook có chữ ký HMAC-SHA256 và đồng bộ GitHub.
`;

  const sampleWebhookPy = `import hmac
import hashlib
import json

def verify_webhook_signature(raw_body: bytes, secret: str, header_sig: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, header_sig)

payload = {"event": "file.saved", "file": "demo.py"}
print(json.dumps(payload, ensure_ascii=False))
`;

  return {
    users: {},
    files: [],
    community: [
      {
        id: 'comm_seed_1',
        fileId: 'seed_file_1',
        filename: 'biometric_integrity.py',
        fileType: 'py',
        content: samplePy,
        contentHash: crypto.createHash('sha256').update(samplePy).digest('hex'),
        isEncryptedVaultCopy: true,
        authorUsername: 'linh_sec',
        authorDisplayName: 'Nguyễn Thùy Linh',
        likes: 18,
        forks: 5,
        webhookDeliveryId: 'wh_seed_01',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'comm_seed_2',
        fileId: 'seed_file_2',
        filename: 'kien_truc_bao_mat.md',
        fileType: 'md',
        content: sampleMd,
        contentHash: crypto.createHash('sha256').update(sampleMd).digest('hex'),
        isEncryptedVaultCopy: true,
        authorUsername: 'minh_dev',
        authorDisplayName: 'Trần Quang Minh',
        likes: 14,
        forks: 3,
        webhookDeliveryId: 'wh_seed_02',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'comm_seed_3',
        fileId: 'seed_file_3',
        filename: 'webhook_hmac_verifier.py',
        fileType: 'py',
        content: sampleWebhookPy,
        contentHash: crypto.createHash('sha256').update(sampleWebhookPy).digest('hex'),
        isEncryptedVaultCopy: false,
        authorUsername: 'anh_cloud',
        authorDisplayName: 'Phạm Hoàng Anh',
        likes: 11,
        forks: 4,
        webhookDeliveryId: 'wh_seed_03',
        createdAt: now,
        updatedAt: now,
      },
    ],
    webhookLogs: [
      {
        id: 'wh_seed_01',
        event: 'file.published',
        targetUrl: 'internal://webhook-vault',
        filename: 'biometric_integrity.py',
        authorUsername: 'linh_sec',
        statusCode: 200,
        ok: true,
        signature: 'sha256=89f4e2c1a0...verified',
        payloadPreview: '{"event":"file.published","filename":"biometric_integrity.py","type":"py"}',
        createdAt: now,
      },
    ],
    webhookInbox: [],
  };
}

function loadStore(): StoreSchema {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    const initial = createInitialStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoreSchema;
    return {
      users: parsed.users || {},
      files: parsed.files || [],
      community: parsed.community || [],
      webhookLogs: parsed.webhookLogs || [],
      webhookInbox: parsed.webhookInbox || [],
    };
  } catch {
    const fallback = createInitialStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

const store: StoreSchema = loadStore();

function saveStore(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function maskToken(token: string): string {
  if (!token) return '';
  if (token.length <= 8) return '••••••••';
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

function toAuthUser(user: StoredUser): AuthUser {
  const githubConfig: GitHubConfigSummary = {
    owner: user.githubConfig.owner,
    repo: user.githubConfig.repo,
    branch: user.githubConfig.branch || 'main',
    folder: user.githubConfig.folder || 'vault',
    hasToken: Boolean(user.githubConfig.token || process.env.GITHUB_DEFAULT_TOKEN),
    maskedToken: maskToken(user.githubConfig.token || ''),
  };
  const webhookConfig: WebhookConfigSummary = {
    webhookUrl: user.webhookConfig.webhookUrl || '',
    hasSecret: Boolean(user.webhookConfig.secret),
    autoDispatchOnSave: user.webhookConfig.autoDispatchOnSave,
    format: user.webhookConfig.format || 'json',
  };
  return {
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt,
    faceEnrolledAngles: user.faceEnrolledAngles,
    biometricFingerprint: user.biometricFingerprint,
    githubConfig,
    webhookConfig,
  };
}

function isSafeExternalWebhookUrl(rawUrl: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, reason: 'Chỉ hỗ trợ giao thức HTTP hoặc HTTPS.' };
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.startsWith('169.254.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return {
        valid: false,
        reason: 'Địa chỉ Webhook nội bộ hoặc loopback không được phép vì lý do bảo mật.',
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'URL Webhook không hợp lệ.' };
  }
}

async function dispatchWebhookPayload(params: {
  event: 'file.saved' | 'file.published' | 'webhook.test';
  user: StoredUser;
  filename: string;
  fileType: string;
  content: string;
  contentHash: string;
  isEncrypted: boolean;
  githubUrl?: string;
}): Promise<WebhookDeliveryLog> {
  const { event, user, filename, fileType, content, contentHash, isEncrypted, githubUrl } =
    params;
  const deliveryId = `wh_${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();

  const rawPayload = {
    deliveryId,
    event,
    timestamp: now,
    author: {
      username: user.username,
      displayName: user.displayName,
    },
    file: {
      filename,
      fileType,
      isEncrypted,
      sha256: contentHash,
      githubUrl: githubUrl || null,
      content,
    },
  };

  const signingSecret = user.webhookConfig.secret || 'aegisvault-webhook-default';
  const bodyForSignature = JSON.stringify(rawPayload);
  const signature =
    'sha256=' +
    crypto.createHmac('sha256', signingSecret).update(bodyForSignature).digest('hex');

  // Always record directly in the built-in Webhook Storage Inbox so direct webhook persistence is guaranteed
  store.webhookInbox.unshift({
    id: deliveryId,
    receivedAt: now,
    event,
    signature,
    payload: rawPayload,
  });
  store.webhookInbox = store.webhookInbox.slice(0, 100);

  const externalUrl = (
    user.webhookConfig.webhookUrl ||
    process.env.DEFAULT_WEBHOOK_URL ||
    ''
  ).trim();

  if (!externalUrl) {
    const log: WebhookDeliveryLog = {
      id: deliveryId,
      event,
      targetUrl: 'internal://webhook-vault',
      filename,
      authorUsername: user.username,
      statusCode: 200,
      ok: true,
      signature,
      payloadPreview: bodyForSignature.slice(0, 220),
      createdAt: now,
    };
    store.webhookLogs.unshift(log);
    store.webhookLogs = store.webhookLogs.slice(0, 100);
    saveStore();
    return log;
  }

  const safety = isSafeExternalWebhookUrl(externalUrl);
  if (!safety.valid) {
    const errLog: WebhookDeliveryLog = {
      id: deliveryId,
      event,
      targetUrl: externalUrl,
      filename,
      authorUsername: user.username,
      statusCode: 400,
      ok: false,
      signature,
      payloadPreview: bodyForSignature.slice(0, 220),
      createdAt: now,
      error: safety.reason,
    };
    store.webhookLogs.unshift(errLog);
    store.webhookLogs = store.webhookLogs.slice(0, 100);
    saveStore();
    return errLog;
  }

  const isDiscord =
    user.webhookConfig.format === 'discord' || externalUrl.includes('discord.com/api/webhooks');
  const wireBody = isDiscord
    ? JSON.stringify({
        username: 'AegisVault Bot',
        content: `**${user.displayName}** đã lưu tệp \`${filename}\` (\`${fileType}\`)`,
        embeds: [
          {
            title: filename,
            description: `\`\`\`${fileType}\n${content.slice(0, 1500)}\n\`\`\``,
            color: 0x0ea5e9,
            footer: { text: `SHA-256: ${contentHash.slice(0, 16)}... · ${deliveryId}` },
            timestamp: now,
          },
        ],
      })
    : bodyForSignature;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(externalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Aegis-Event': event,
        'X-Aegis-Delivery': deliveryId,
        'X-Aegis-Signature': signature,
      },
      body: wireBody,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const log: WebhookDeliveryLog = {
      id: deliveryId,
      event,
      targetUrl: externalUrl,
      filename,
      authorUsername: user.username,
      statusCode: resp.status,
      ok: resp.ok,
      signature,
      payloadPreview: wireBody.slice(0, 220),
      createdAt: now,
      error: resp.ok ? undefined : `HTTP ${resp.status}`,
    };
    store.webhookLogs.unshift(log);
    store.webhookLogs = store.webhookLogs.slice(0, 100);
    saveStore();
    return log;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi kết nối Webhook';
    const failLog: WebhookDeliveryLog = {
      id: deliveryId,
      event,
      targetUrl: externalUrl,
      filename,
      authorUsername: user.username,
      statusCode: 502,
      ok: false,
      signature,
      payloadPreview: wireBody.slice(0, 220),
      createdAt: now,
      error: message,
    };
    store.webhookLogs.unshift(failLog);
    store.webhookLogs = store.webhookLogs.slice(0, 100);
    saveStore();
    return failLog;
  }
}

async function commitFileToGitHub(params: {
  owner: string;
  repo: string;
  branch: string;
  repoPath: string;
  token: string;
  content: string;
  commitMessage: string;
}): Promise<{
  synced: boolean;
  commitSha?: string;
  htmlUrl?: string;
  error?: string;
}> {
  const { owner, repo, branch, repoPath, token, content, commitMessage } = params;
  if (!owner || !repo || !token) {
    return { synced: false, error: 'Chưa cấu hình GitHub Repo hoặc Token (PAT).' };
  }
  const safeOwner = owner.trim().replace(/[^a-zA-Z0-9._-]/g, '');
  const safeRepo = repo.trim().replace(/[^a-zA-Z0-9._-]/g, '');
  const apiUrl = `https://api.github.com/repos/${safeOwner}/${safeRepo}/contents/${repoPath}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'AegisVault-App',
    'Content-Type': 'application/json',
  };

  try {
    let existingSha: string | undefined;
    const getResp = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, {
      method: 'GET',
      headers,
    });
    if (getResp.ok) {
      const existingData = (await getResp.json()) as { sha?: string };
      existingSha = existingData.sha;
    }

    const putResp = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    });

    if (!putResp.ok) {
      const errBody = (await putResp.json().catch(() => ({}))) as { message?: string };
      return {
        synced: false,
        error: errBody.message || `GitHub trả về mã lỗi HTTP ${putResp.status}`,
      };
    }

    const data = (await putResp.json()) as {
      content?: { html_url?: string };
      commit?: { sha?: string };
    };
    return {
      synced: true,
      commitSha: data.commit?.sha,
      htmlUrl: data.content?.html_url,
    };
  } catch (err) {
    return {
      synced: false,
      error: err instanceof Error ? err.message : 'Không thể kết nối GitHub API.',
    };
  }
}

interface AuthenticatedRequest extends Request {
  authUser?: StoredUser;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Vui lòng đăng nhập bằng Face ID 3D.' });
    return;
  }
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn, vui lòng quét lại Face ID.' });
    return;
  }
  const user = store.users[session.username];
  if (!user) {
    res.status(401).json({ error: 'Tài khoản không tồn tại.' });
    return;
  }
  req.authUser = user;
  next();
}

function detectFileType(filename: string): VaultFileType {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  if (ext === 'py' || ext === 'md' || ext === 'txt' || ext === 'json' || ext === 'ts') {
    return ext;
  }
  return 'txt';
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'AegisVault' });
  });

  app.post('/api/auth/register', (req, res) => {
    const body = req.body as {
      username?: string;
      displayName?: string;
      passphrase?: string;
      enrolledBundle?: FaceScanFrame[];
    };

    const username = (body.username || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const displayName = (body.displayName || username).trim();
    const passphrase = body.passphrase || '';
    const enrolledBundle = Array.isArray(body.enrolledBundle) ? body.enrolledBundle : [];

    if (!username || username.length < 3) {
      res.status(400).json({ error: 'Tên tài khoản cần ít nhất 3 ký tự hợp lệ.' });
      return;
    }
    if (!passphrase || passphrase.length < 6) {
      res.status(400).json({ error: 'Mật khẩu mã hóa cần ít nhất 6 ký tự.' });
      return;
    }
    if (enrolledBundle.length < 5) {
      res.status(400).json({
        error: 'Cần hoàn tất đủ 5 góc quét Face ID 360° trước khi tạo tài khoản.',
      });
      return;
    }
    if (store.users[username]) {
      res.status(409).json({ error: 'Tên tài khoản này đã được đăng ký.' });
      return;
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passphraseHash = hashPassphrase(passphrase, salt);
    const fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify(enrolledBundle.map((f) => f.descriptor)))
      .digest('hex')
      .slice(0, 16);

    const newUser: StoredUser = {
      username,
      displayName,
      passphraseHash,
      passphraseSalt: salt,
      encryptedBiometricBundle: sealServerJson(enrolledBundle),
      biometricFingerprint: fingerprint,
      faceEnrolledAngles: enrolledBundle.length,
      createdAt: new Date().toISOString(),
      githubConfig: {
        owner: '',
        repo: '',
        branch: 'main',
        folder: 'vault',
        token: '',
      },
      webhookConfig: {
        webhookUrl: '',
        secret: '',
        autoDispatchOnSave: true,
        format: 'json',
      },
    };

    store.users[username] = newUser;
    saveStore();

    const token = createSessionToken(username);
    res.status(201).json({
      token,
      user: toAuthUser(newUser),
    });
  });

  app.post('/api/auth/challenge', (req, res) => {
    const body = req.body as { username?: string };
    const username = (body.username || '').trim().toLowerCase();
    const user = store.users[username];
    if (!user) {
      res.status(404).json({ error: 'Không tìm thấy tài khoản này.' });
      return;
    }
    res.json({
      username: user.username,
      displayName: user.displayName,
      faceEnrolledAngles: user.faceEnrolledAngles,
      biometricFingerprint: user.biometricFingerprint,
    });
  });

  app.post('/api/auth/verify-face', (req, res) => {
    const body = req.body as {
      username?: string;
      passphrase?: string;
      liveBundle?: FaceScanFrame[];
    };

    const username = (body.username || '').trim().toLowerCase();
    const liveBundle = Array.isArray(body.liveBundle) ? body.liveBundle : [];
    const user = store.users[username];

    if (!user) {
      res.status(404).json({ error: 'Không tìm thấy tài khoản để đối chiếu 3D.' });
      return;
    }
    if (liveBundle.length === 0) {
      res.status(400).json({ error: 'Chưa có dữ liệu quét khuôn mặt.' });
      return;
    }
    if (body.passphrase) {
      const checkHash = hashPassphrase(body.passphrase, user.passphraseSalt);
      if (checkHash !== user.passphraseHash) {
        res.status(401).json({ error: 'Mật khẩu mã hóa không chính xác.' });
        return;
      }
    }

    const enrolledBundle = unsealServerJson<FaceScanFrame[]>(user.encryptedBiometricBundle);
    if (!enrolledBundle) {
      res.status(500).json({ error: 'Không thể giải mã mẫu sinh trắc học đã lưu.' });
      return;
    }

    const comparison = compare3DFaceModels(enrolledBundle, liveBundle);

    if (!comparison.matched) {
      res.status(401).json({
        error: `Khuôn mặt không khớp với mô hình 3D đã đăng ký (Độ khớp ${(comparison.similarity * 100).toFixed(1)}%).`,
        comparison,
      });
      return;
    }

    const token = createSessionToken(username);
    res.json({
      token,
      user: toAuthUser(user),
      comparison,
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: toAuthUser(req.authUser!) });
  });

  app.get('/api/files', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const userFiles = store.files
      .filter((f) => f.authorUsername === user.username)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json({ files: userFiles });
  });

  app.post('/api/files', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const body = req.body as {
      id?: string;
      filename?: string;
      content?: string;
      encryptedPayload?: VaultFileRecord['encryptedPayload'];
      isEncrypted?: boolean;
      isPublicCommunity?: boolean;
      syncToGitHub?: boolean;
      dispatchWebhook?: boolean;
    };

    const filename = (body.filename || '').trim();
    const content = body.content ?? '';
    if (!filename) {
      res.status(400).json({ error: 'Tên tệp không được để trống.' });
      return;
    }
    if (!content.trim()) {
      res.status(400).json({ error: 'Nội dung tệp không được để trống.' });
      return;
    }

    const fileType = detectFileType(filename);
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const now = new Date().toISOString();
    const fileId = body.id || `file_${crypto.randomBytes(6).toString('hex')}`;
    const publishCommunity = body.isPublicCommunity !== false;

    const existingIdx = store.files.findIndex(
      (f) => f.id === fileId && f.authorUsername === user.username,
    );

    const record: VaultFileRecord = {
      id: fileId,
      filename,
      fileType,
      encryptedPayload: body.encryptedPayload,
      content,
      contentHash,
      isEncrypted: Boolean(body.isEncrypted),
      isPublicCommunity: publishCommunity,
      authorUsername: user.username,
      authorDisplayName: user.displayName,
      createdAt: existingIdx >= 0 ? store.files[existingIdx].createdAt : now,
      updatedAt: now,
      syncStatus: {},
    };

    // 1. Direct GitHub Sync (if configured or requested)
    const ghToken = user.githubConfig.token || process.env.GITHUB_DEFAULT_TOKEN || '';
    if (
      (body.syncToGitHub !== false && user.githubConfig.owner && user.githubConfig.repo && ghToken) ||
      body.syncToGitHub === true
    ) {
      const repoPath = sanitizeRepoPath(filename, user.githubConfig.folder || 'vault');
      const ghResult = await commitFileToGitHub({
        owner: user.githubConfig.owner,
        repo: user.githubConfig.repo,
        branch: user.githubConfig.branch || 'main',
        repoPath,
        token: ghToken,
        content,
        commitMessage: `chore(vault): save ${filename} via AegisVault`,
      });
      record.syncStatus.github = {
        synced: ghResult.synced,
        repo:
          user.githubConfig.owner && user.githubConfig.repo
            ? `${user.githubConfig.owner}/${user.githubConfig.repo}`
            : 'Chưa cấu hình',
        path: repoPath,
        commitSha: ghResult.commitSha,
        htmlUrl: ghResult.htmlUrl,
        error: ghResult.error,
        syncedAt: now,
      };
    }

    // 2. Direct Webhook Storage Dispatch (always active on save unless explicitly false)
    if (body.dispatchWebhook !== false) {
      const whLog = await dispatchWebhookPayload({
        event: publishCommunity ? 'file.published' : 'file.saved',
        user,
        filename,
        fileType,
        content: body.isEncrypted && body.encryptedPayload ? body.encryptedPayload.ciphertext : content,
        contentHash,
        isEncrypted: Boolean(body.isEncrypted),
        githubUrl: record.syncStatus.github?.htmlUrl,
      });
      record.syncStatus.webhook = {
        dispatched: whLog.ok,
        targetUrl: whLog.targetUrl,
        statusCode: whLog.statusCode,
        deliveryId: whLog.id,
        signature: whLog.signature,
        error: whLog.error,
        dispatchedAt: whLog.createdAt,
      };
    }

    // 3. Auto-publish to Community Feed
    if (publishCommunity) {
      const postId = `comm_${fileId}`;
      const existingCommIdx = store.community.findIndex((p) => p.fileId === fileId);
      const commPost: CommunityPost = {
        id: existingCommIdx >= 0 ? store.community[existingCommIdx].id : postId,
        fileId,
        filename,
        fileType,
        content,
        contentHash,
        isEncryptedVaultCopy: Boolean(body.isEncrypted),
        authorUsername: user.username,
        authorDisplayName: user.displayName,
        likes: existingCommIdx >= 0 ? store.community[existingCommIdx].likes : 0,
        forks: existingCommIdx >= 0 ? store.community[existingCommIdx].forks : 0,
        githubUrl: record.syncStatus.github?.htmlUrl,
        webhookDeliveryId: record.syncStatus.webhook?.deliveryId,
        createdAt: existingCommIdx >= 0 ? store.community[existingCommIdx].createdAt : now,
        updatedAt: now,
      };
      if (existingCommIdx >= 0) {
        store.community[existingCommIdx] = commPost;
      } else {
        store.community.unshift(commPost);
      }
      record.syncStatus.community = {
        published: true,
        postId: commPost.id,
      };
    }

    if (existingIdx >= 0) {
      store.files[existingIdx] = record;
    } else {
      store.files.unshift(record);
    }

    saveStore();
    res.status(201).json({ file: record });
  });

  app.delete('/api/files/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const fileId = req.params.id;
    const idx = store.files.findIndex(
      (f) => f.id === fileId && f.authorUsername === user.username,
    );
    if (idx < 0) {
      res.status(404).json({ error: 'Không tìm thấy tệp hoặc bạn không có quyền xóa.' });
      return;
    }
    store.files.splice(idx, 1);
    store.community = store.community.filter((p) => p.fileId !== fileId);
    saveStore();
    res.json({ deleted: true });
  });

  app.get('/api/community', (_req, res) => {
    const posts = [...store.community].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    res.json({ posts });
  });

  app.post('/api/community/:id/like', (req, res) => {
    const post = store.community.find((p) => p.id === req.params.id);
    if (!post) {
      res.status(404).json({ error: 'Không tìm thấy bài đăng cộng đồng.' });
      return;
    }
    post.likes += 1;
    saveStore();
    res.json({ post });
  });

  app.post('/api/community/:id/fork', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const post = store.community.find((p) => p.id === req.params.id);
    if (!post) {
      res.status(404).json({ error: 'Không tìm thấy bài đăng cộng đồng.' });
      return;
    }
    post.forks += 1;
    const now = new Date().toISOString();
    const forkedId = `file_${crypto.randomBytes(6).toString('hex')}`;
    const forkedRecord: VaultFileRecord = {
      id: forkedId,
      filename: `fork_${post.filename}`,
      fileType: post.fileType,
      content: post.content,
      contentHash: post.contentHash,
      isEncrypted: false,
      isPublicCommunity: false,
      authorUsername: user.username,
      authorDisplayName: user.displayName,
      createdAt: now,
      updatedAt: now,
      syncStatus: {},
    };
    store.files.unshift(forkedRecord);
    saveStore();
    res.status(201).json({ file: forkedRecord, post });
  });

  app.post('/api/github/config', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const body = req.body as {
      owner?: string;
      repo?: string;
      branch?: string;
      folder?: string;
      token?: string;
    };

    user.githubConfig.owner = (body.owner || '').trim();
    user.githubConfig.repo = (body.repo || '').trim();
    user.githubConfig.branch = (body.branch || 'main').trim() || 'main';
    user.githubConfig.folder = (body.folder || 'vault').trim() || 'vault';
    if (typeof body.token === 'string' && body.token.trim()) {
      user.githubConfig.token = body.token.trim();
    }
    saveStore();
    res.json({ user: toAuthUser(user) });
  });

  app.post('/api/github/push-site', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const token = user.githubConfig.token || process.env.GITHUB_DEFAULT_TOKEN || '';
    const { owner, repo, branch } = user.githubConfig;

    if (!owner || !repo || !token) {
      res.status(400).json({
        error: 'Vui lòng nhập GitHub Owner, Repo và Personal Access Token (PAT) trước khi đẩy web lên GitHub.',
      });
      return;
    }

    const workflowYaml = generateGitHubPagesWorkflow(repo);
    const readmeContent = `# ${repo}\n\nKho lưu trữ ghi chú & mã Python **AegisVault** (đồng bộ trực tiếp từ AegisVault với Face ID 3D & AES-256-GCM).\n`;

    const workflowCommit = await commitFileToGitHub({
      owner,
      repo,
      branch: branch || 'main',
      repoPath: '.github/workflows/deploy.yml',
      token,
      content: workflowYaml,
      commitMessage: 'ci: add AegisVault GitHub Pages deployment workflow',
    });

    const readmeCommit = await commitFileToGitHub({
      owner,
      repo,
      branch: branch || 'main',
      repoPath: 'README.md',
      token,
      content: readmeContent,
      commitMessage: 'docs: update AegisVault repository README',
    });

    if (!workflowCommit.synced) {
      res.status(400).json({
        error: workflowCommit.error || 'Không thể đẩy tệp lên GitHub.',
      });
      return;
    }

    res.json({
      pushed: true,
      workflowUrl: workflowCommit.htmlUrl,
      readmeUrl: readmeCommit.htmlUrl,
      pagesUrl: `https://${owner}.github.io/${repo}/`,
    });
  });

  app.post('/api/webhooks/config', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const body = req.body as {
      webhookUrl?: string;
      secret?: string;
      autoDispatchOnSave?: boolean;
      format?: 'json' | 'discord';
    };

    const url = (body.webhookUrl || '').trim();
    if (url) {
      const check = isSafeExternalWebhookUrl(url);
      if (!check.valid) {
        res.status(400).json({ error: check.reason });
        return;
      }
    }

    user.webhookConfig.webhookUrl = url;
    if (typeof body.secret === 'string') {
      user.webhookConfig.secret = body.secret.trim();
    }
    if (typeof body.autoDispatchOnSave === 'boolean') {
      user.webhookConfig.autoDispatchOnSave = body.autoDispatchOnSave;
    }
    if (body.format === 'json' || body.format === 'discord') {
      user.webhookConfig.format = body.format;
    }

    saveStore();
    res.json({ user: toAuthUser(user) });
  });

  app.post('/api/webhooks/test', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const sampleContent = 'print("AegisVault Webhook connectivity verified")';
    const log = await dispatchWebhookPayload({
      event: 'webhook.test',
      user,
      filename: 'webhook_ping.py',
      fileType: 'py',
      content: sampleContent,
      contentHash: crypto.createHash('sha256').update(sampleContent).digest('hex'),
      isEncrypted: false,
    });
    res.json({ log });
  });

  app.get('/api/webhooks/logs', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const logs = store.webhookLogs.filter(
      (l) => l.authorUsername === user.username || l.id.startsWith('wh_seed'),
    );
    const inbox = store.webhookInbox.slice(0, 25);
    res.json({ logs, inbox });
  });

  // Public built-in webhook receiver endpoint for direct webhook persistence testing
  app.post('/api/webhook/receive', (req, res) => {
    const id = `wh_in_${crypto.randomBytes(6).toString('hex')}`;
    const sig = String(req.headers['x-aegis-signature'] || 'unsigned');
    const event = String(req.headers['x-aegis-event'] || 'external.push');
    const entry = {
      id,
      receivedAt: new Date().toISOString(),
      event,
      signature: sig,
      payload: (req.body && typeof req.body === 'object' ? req.body : { raw: req.body }) as Record<
        string,
        unknown
      >,
    };
    store.webhookInbox.unshift(entry);
    store.webhookInbox = store.webhookInbox.slice(0, 100);
    saveStore();
    res.status(200).json({ received: true, id });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AegisVault server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
