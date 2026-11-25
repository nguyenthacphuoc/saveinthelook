import { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  GitBranch,
  Rocket,
  Send,
  ShieldAlert,
  Webhook,
} from 'lucide-react';
import type { AuthUser, WebhookDeliveryLog } from '../types';
import { generateGitHubPagesWorkflow, generateGitPushGuide } from '../utils/githubDeploy';

interface GitHubWebhookHubProps {
  user: AuthUser | null;
  token: string | null;
  webhookLogs: WebhookDeliveryLog[];
  onUserUpdated: (user: AuthUser) => void;
  onLogsRefreshed: () => void;
  onRequireAuth: () => void;
}

export function GitHubWebhookHub({
  user,
  token,
  webhookLogs,
  onUserUpdated,
  onLogsRefreshed,
  onRequireAuth,
}: GitHubWebhookHubProps) {
  const [owner, setOwner] = useState(user?.githubConfig.owner || '');
  const [repo, setRepo] = useState(user?.githubConfig.repo || '');
  const [branch, setBranch] = useState(user?.githubConfig.branch || 'main');
  const [folder, setFolder] = useState(user?.githubConfig.folder || 'vault');
  const [ghToken, setGhToken] = useState('');

  const [webhookUrl, setWebhookUrl] = useState(user?.webhookConfig.webhookUrl || '');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [webhookFormat, setWebhookFormat] = useState<'json' | 'discord'>(
    user?.webhookConfig.format || 'json',
  );

  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pagesResult, setPagesResult] = useState<{
    pagesUrl: string;
    workflowUrl?: string;
  } | null>(null);

  const workflowPreview = generateGitHubPagesWorkflow(repo || 'aegis-vault-web');
  const gitGuide = generateGitPushGuide(owner || 'username', repo || 'aegis-vault-web', branch || 'main');

  const handleSaveGitHub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !token) {
      onRequireAuth();
      return;
    }
    setBusyAction('gh-save');
    setStatusMsg(null);
    try {
      const resp = await fetch('/api/github/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ owner, repo, branch, folder, token: ghToken }),
      });
      const data = (await resp.json()) as { user?: AuthUser; error?: string };
      if (!resp.ok || !data.user) {
        setStatusMsg({ type: 'err', text: data.error || 'Không thể lưu cấu hình GitHub.' });
        return;
      }
      onUserUpdated(data.user);
      setGhToken('');
      setStatusMsg({ type: 'ok', text: 'Đã lưu cấu hình đồng bộ GitHub.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handlePushWebToGitHub = async () => {
    if (!user || !token) {
      onRequireAuth();
      return;
    }
    setBusyAction('gh-push');
    setStatusMsg(null);
    try {
      const resp = await fetch('/api/github/push-site', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await resp.json()) as {
        pushed?: boolean;
        pagesUrl?: string;
        workflowUrl?: string;
        error?: string;
      };
      if (!resp.ok || !data.pushed) {
        setStatusMsg({
          type: 'err',
          text: data.error || 'Không thể đẩy workflow GitHub Pages.',
        });
        return;
      }
      setPagesResult({ pagesUrl: data.pagesUrl || '', workflowUrl: data.workflowUrl });
      setStatusMsg({
        type: 'ok',
        text: 'Đã commit tệp deploy.yml & README.md trực tiếp lên kho GitHub của bạn.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !token) {
      onRequireAuth();
      return;
    }
    setBusyAction('wh-save');
    setStatusMsg(null);
    try {
      const resp = await fetch('/api/webhooks/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          webhookUrl,
          secret: webhookSecret,
          autoDispatchOnSave: true,
          format: webhookFormat,
        }),
      });
      const data = (await resp.json()) as { user?: AuthUser; error?: string };
      if (!resp.ok || !data.user) {
        setStatusMsg({ type: 'err', text: data.error || 'Không thể lưu Webhook.' });
        return;
      }
      onUserUpdated(data.user);
      setStatusMsg({ type: 'ok', text: 'Đã lưu cấu hình lưu trữ trực tiếp qua Webhook.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestWebhook = async () => {
    if (!user || !token) {
      onRequireAuth();
      return;
    }
    setBusyAction('wh-test');
    setStatusMsg(null);
    try {
      const resp = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await resp.json()) as { log?: WebhookDeliveryLog };
      onLogsRefreshed();
      if (data.log?.ok) {
        setStatusMsg({
          type: 'ok',
          text: `Đã gửi Webhook thử nghiệm (${data.log.id}) · HTTP ${data.log.statusCode}.`,
        });
      } else {
        setStatusMsg({
          type: 'err',
          text: data.log?.error || 'Gửi Webhook thất bại.',
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="mx-auto max-w-[1320px] px-4 py-8 sm:px-8 space-y-8">
      <div className="border-b border-slate-800 pb-5">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-50">
          Đồng bộ GitHub, Xuất bản Web & Webhook Trực tiếp
        </h1>
        <p className="mt-1.5 text-sm text-slate-400">
          Kết nối kho GitHub để lưu trực tiếp ghi chú/.py, xuất bản web lên GitHub Pages và cấu hình Webhook lưu trữ tức thì.
        </p>
      </div>

      {!user && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-200">
          <span>Bạn cần đăng nhập bằng Face ID 3D để lưu token GitHub và cấu hình Webhook cá nhân.</span>
          <button
            type="button"
            onClick={onRequireAuth}
            className="rounded-lg bg-sky-500 px-3.5 py-2 font-semibold text-slate-950 hover:bg-sky-400"
          >
            Đăng nhập Face ID
          </button>
        </div>
      )}

      {statusMsg && (
        <div
          role={statusMsg.type === 'err' ? 'alert' : 'status'}
          className={`rounded-lg border px-4 py-3 text-xs flex items-center gap-2 ${
            statusMsg.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
              : 'border-rose-500/40 bg-rose-950/40 text-rose-200'
          }`}
        >
          {statusMsg.type === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Card 1: GitHub Direct Storage & GitHub Pages Deploy */}
        <div className="rounded-xl border border-slate-800 bg-[#0F1624] p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <GitBranch className="h-5 w-5 text-sky-400" aria-hidden="true" />
            <h2 className="font-display text-lg font-semibold text-slate-100">
              Lưu trữ & Xuất bản Web lên GitHub
            </h2>
          </div>

          <form onSubmit={handleSaveGitHub} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="gh-owner" className="block text-xs font-medium text-slate-300">
                  GitHub Owner / Username
                </label>
                <input
                  id="gh-owner"
                  type="text"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder="vd: octocat"
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="gh-repo" className="block text-xs font-medium text-slate-300">
                  Tên Repository
                </label>
                <input
                  id="gh-repo"
                  type="text"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="vd: my-python-vault"
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="gh-branch" className="block text-xs font-medium text-slate-300">
                  Nhánh (Branch)
                </label>
                <input
                  id="gh-branch"
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-slate-100 focus:border-sky-400 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="gh-folder" className="block text-xs font-medium text-slate-300">
                  Thư mục lưu file
                </label>
                <input
                  id="gh-folder"
                  type="text"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-slate-100 focus:border-sky-400 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="gh-pat" className="block text-xs font-medium text-slate-300">
                GitHub Personal Access Token (PAT · quyền repo)
              </label>
              <input
                id="gh-pat"
                type="password"
                value={ghToken}
                onChange={(e) => setGhToken(e.target.value)}
                placeholder={
                  user?.githubConfig.hasToken
                    ? `Đã lưu (${user.githubConfig.maskedToken}) — nhập mới nếu muốn đổi`
                    : 'ghp_...'
                }
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-slate-100 focus:border-sky-400 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={busyAction !== null}
                className="rounded-lg bg-slate-800 border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-100 hover:border-sky-500/60"
              >
                Lưu cấu hình GitHub
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handlePushWebToGitHub}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Đẩy Workflow GitHub Pages</span>
              </button>
            </div>
          </form>

          {pagesResult && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-3 text-xs text-emerald-200">
              URL GitHub Pages dự kiến:{' '}
              <span className="font-mono font-semibold">{pagesResult.pagesUrl}</span>
            </div>
          )}

          {/* Ready-to-use GitHub Pages workflow & Git push commands */}
          <div className="border-t border-slate-800 pt-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span className="font-medium">Workflow tự động đăng web (.github/workflows/deploy.yml)</span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(workflowPreview)}
                className="inline-flex items-center gap-1 text-sky-400 hover:underline"
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
                <span>Sao chép YAML</span>
              </button>
            </div>
            <pre className="max-h-36 overflow-auto rounded-lg border border-slate-800 bg-[#080C14] p-3 font-mono text-[11px] text-slate-300">
              <code>{workflowPreview}</code>
            </pre>

            <div className="flex items-center justify-between text-xs text-slate-300">
              <span className="font-medium">Lệnh Git đẩy toàn bộ mã nguồn web lên GitHub</span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(gitGuide)}
                className="inline-flex items-center gap-1 text-sky-400 hover:underline"
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
                <span>Sao chép lệnh</span>
              </button>
            </div>
            <pre className="overflow-auto rounded-lg border border-slate-800 bg-[#080C14] p-3 font-mono text-[11px] text-slate-300">
              <code>{gitGuide}</code>
            </pre>
          </div>
        </div>

        {/* Card 2: Direct Webhook Storage */}
        <div className="rounded-xl border border-slate-800 bg-[#0F1624] p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <Webhook className="h-5 w-5 text-sky-400" aria-hidden="true" />
            <h2 className="font-display text-lg font-semibold text-slate-100">
              Lưu trữ trực tiếp trên Webhook
            </h2>
          </div>

          <form onSubmit={handleSaveWebhook} className="space-y-4">
            <div>
              <label htmlFor="wh-url" className="block text-xs font-medium text-slate-300">
                Webhook URL đích (Discord, Slack hoặc Endpoint tùy chỉnh)
              </label>
              <input
                id="wh-url"
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-slate-100 focus:border-sky-400 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Nếu để trống, hệ thống vẫn lưu trực tiếp qua Webhook nội bộ kèm chữ ký HMAC-SHA256.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="wh-secret" className="block text-xs font-medium text-slate-300">
                  Khóa ký HMAC-SHA256
                </label>
                <input
                  id="wh-secret"
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="Tùy chọn để xác thực chữ ký"
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-slate-100 focus:border-sky-400 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="wh-format" className="block text-xs font-medium text-slate-300">
                  Định dạng dữ liệu Webhook
                </label>
                <select
                  id="wh-format"
                  value={webhookFormat}
                  onChange={(e) =>
                    setWebhookFormat(e.target.value === 'discord' ? 'discord' : 'json')
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
                >
                  <option value="json">JSON chuẩn (Full Payload + SHA256)</option>
                  <option value="discord">Discord Webhook Embed</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={busyAction !== null}
                className="rounded-lg bg-slate-800 border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-100 hover:border-sky-500/60"
              >
                Lưu cấu hình Webhook
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleTestWebhook}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Gửi Webhook kiểm tra</span>
              </button>
            </div>
          </form>

          {/* Delivery Logs Table */}
          <div className="border-t border-slate-800 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-slate-200">
                Nhật ký lưu trực tiếp qua Webhook
              </h3>
              <span className="font-mono text-xs text-slate-400 tabular-nums">
                {webhookLogs.length} bản ghi
              </span>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {webhookLogs.length === 0 ? (
                <p className="text-xs text-slate-500">Chưa có bản ghi Webhook nào.</p>
              ) : (
                webhookLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg border border-slate-800 bg-[#080C14] p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-medium text-slate-100 truncate">
                        {log.filename} · {log.event}
                      </span>
                      <span
                        className={`font-mono tabular-nums ${
                          log.ok ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        HTTP {log.statusCode}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-slate-400 truncate">
                      {log.targetUrl} · {log.signature.slice(0, 26)}...
                    </p>
                    <p className="font-mono text-[11px] text-slate-500 truncate">
                      {log.payloadPreview}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
