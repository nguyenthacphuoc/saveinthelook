import { useState } from 'react';
import { motion } from 'motion/react';
import {
  CheckCircle2,
  Code2,
  Copy,
  FileText,
  GitBranch,
  Globe,
  Lock,
  Plus,
  Save,
  Search,
  Trash2,
  Webhook,
} from 'lucide-react';
import type { AuthUser, VaultFileRecord, VaultFileType } from '../types';
import { encryptVaultText } from '../utils/cryptoVault';

interface VaultWorkspaceProps {
  token: string;
  user: AuthUser;
  passphrase: string;
  files: VaultFileRecord[];
  onFilesChanged: (files: VaultFileRecord[]) => void;
  onSyncCompleted: () => void;
  onOpenSyncHub: () => void;
  onOpenCommunity: () => void;
}

const PYTHON_TEMPLATE = `# AegisVault Python Script
import hashlib
from datetime import datetime

def sign_note(title: str, body: str) -> str:
    payload = f"{title}:{body}:{datetime.utcnow().isoformat()}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()

if __name__ == "__main__":
    print("Signature:", sign_note("Demo", "AegisVault AES-256"))
`;

const NOTE_TEMPLATE = `# Ghi chú dự án mới

- Mục tiêu: Lưu trữ an toàn và đồng bộ trực tiếp lên GitHub & Webhook.
- Bảo mật: Đã xác thực khuôn mặt 360° và mã hóa AES-256-GCM.

## Công việc tiếp theo
1. Kiểm tra lại cấu hình Webhook.
2. Chia sẻ bản thảo cho cộng đồng cùng tham khảo.
`;

export function VaultWorkspace({
  token,
  user,
  passphrase,
  files,
  onFilesChanged,
  onSyncCompleted,
  onOpenSyncHub,
  onOpenCommunity,
}: VaultWorkspaceProps) {
  const [selectedId, setSelectedId] = useState<string | null>(files[0]?.id || null);
  const [filename, setFilename] = useState<string>(files[0]?.filename || 'script_moi.py');
  const [content, setContent] = useState<string>(files[0]?.content || PYTHON_TEMPLATE);
  const [isEncrypted, setIsEncrypted] = useState<boolean>(true);
  const [isPublicCommunity, setIsPublicCommunity] = useState<boolean>(true);
  const [syncToGitHub, setSyncToGitHub] = useState<boolean>(
    Boolean(user.githubConfig.owner && user.githubConfig.repo && user.githubConfig.hasToken),
  );
  const [dispatchWebhook, setDispatchWebhook] = useState<boolean>(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | VaultFileType>('all');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [showCipherPreview, setShowCipherPreview] = useState(false);

  const activeFile = files.find((f) => f.id === selectedId) || null;

  const filteredFiles = files.filter((f) => {
    const matchType = typeFilter === 'all' || f.fileType === typeFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchQuery =
      !q ||
      f.filename.toLowerCase().includes(q) ||
      f.content.toLowerCase().includes(q);
    return matchType && matchQuery;
  });

  const handleSelectFile = (file: VaultFileRecord) => {
    setSelectedId(file.id);
    setFilename(file.filename);
    setContent(file.content);
    setIsEncrypted(file.isEncrypted);
    setIsPublicCommunity(file.isPublicCommunity);
    setFeedback(null);
  };

  const handleCreateNew = (preset: 'py' | 'md') => {
    setSelectedId(null);
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    if (preset === 'py') {
      setFilename(`script_${stamp}.py`);
      setContent(PYTHON_TEMPLATE);
    } else {
      setFilename(`ghi_chu_${stamp}.md`);
      setContent(NOTE_TEMPLATE);
    }
    setIsEncrypted(true);
    setIsPublicCommunity(true);
    setFeedback(null);
  };

  const handleSave = async () => {
    setFeedback(null);
    if (!filename.trim()) {
      setFeedback({ type: 'err', text: 'Vui lòng nhập tên tệp (ví dụ: app.py hoặc note.md).' });
      return;
    }
    if (!content.trim()) {
      setFeedback({ type: 'err', text: 'Nội dung tệp không được để trống.' });
      return;
    }

    setSaving(true);
    try {
      const encryptedPayload = isEncrypted
        ? await encryptVaultText(content, passphrase || user.username)
        : undefined;

      const resp = await fetch('/api/files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: selectedId || undefined,
          filename: filename.trim(),
          content,
          encryptedPayload,
          isEncrypted,
          isPublicCommunity,
          syncToGitHub,
          dispatchWebhook,
        }),
      });

      const data = (await resp.json()) as { file?: VaultFileRecord; error?: string };
      if (!resp.ok || !data.file) {
        setFeedback({ type: 'err', text: data.error || 'Không thể lưu tệp.' });
        return;
      }

      const saved = data.file;
      const nextFiles = [saved, ...files.filter((f) => f.id !== saved.id)];
      onFilesChanged(nextFiles);
      setSelectedId(saved.id);
      onSyncCompleted();

      const parts = ['Đã mã hóa & lưu kho'];
      if (saved.syncStatus.webhook?.dispatched) parts.push('đẩy trực tiếp qua Webhook');
      if (saved.syncStatus.community?.published) parts.push('đăng lên Cộng đồng');
      if (saved.syncStatus.github?.synced) parts.push('commit lên GitHub');
      setFeedback({ type: 'ok', text: `${parts.join(', ')}.` });
    } catch {
      setFeedback({ type: 'err', text: 'Lỗi kết nối khi lưu và đồng bộ tệp.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const resp = await fetch(`/api/files/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const nextFiles = files.filter((f) => f.id !== id);
        onFilesChanged(nextFiles);
        if (selectedId === id) {
          if (nextFiles[0]) {
            handleSelectFile(nextFiles[0]);
          } else {
            handleCreateNew('py');
          }
        }
        onSyncCompleted();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const lineCount = content.split('\n').length;

  return (
    <section className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8">
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* Sidebar: File Tree */}
        <aside className="lg:col-span-3 rounded-xl border border-slate-800 bg-[#0F1624] p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-100">
              Tệp của {user.displayName}
            </h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {files.length} tệp
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleCreateNew('py')}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs font-medium text-sky-300 hover:border-sky-500/60 transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>File .py</span>
            </button>
            <button
              type="button"
              onClick={() => handleCreateNew('md')}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Ghi chú .md</span>
            </button>
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm tên tệp hoặc mã..."
              aria-label="Tìm kiếm tệp trong kho"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800">
            {(['all', 'py', 'md'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={`flex-1 rounded py-1 text-[11px] font-medium transition-colors ${
                  typeFilter === t
                    ? 'bg-slate-800 text-sky-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t === 'all' ? 'Tất cả' : `.${t}`}
              </button>
            ))}
          </div>

          <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
            {filteredFiles.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 p-4 text-center text-xs text-slate-400">
                Chưa có tệp nào khớp bộ lọc. Hãy viết mã Python hoặc ghi chú ở khung bên phải rồi bấm Lưu.
              </div>
            ) : (
              filteredFiles.map((file) => {
                const isSelected = file.id === selectedId;
                return (
                  <div
                    key={file.id}
                    className={`group flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
                      isSelected
                        ? 'border-sky-500/60 bg-sky-500/10'
                        : 'border-slate-800/80 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectFile(file)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        {file.fileType === 'py' ? (
                          <Code2 className="h-3.5 w-3.5 text-sky-400 shrink-0" aria-hidden="true" />
                        ) : (
                          <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                        )}
                        <span className="truncate font-mono text-xs font-medium text-slate-100">
                          {file.filename}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                        <span>{file.isEncrypted ? 'AES-256' : 'Chuẩn'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{file.isPublicCommunity ? 'Cộng đồng' : 'Riêng tư'}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      disabled={deletingId === file.id}
                      onClick={() => handleDelete(file.id)}
                      aria-label={`Xóa ${file.filename}`}
                      className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-400 transition-colors shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Main Code & Note Editor */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="lg:col-span-9 space-y-5"
        >
          <div className="rounded-xl border border-slate-800 bg-[#0F1624] p-5 sm:p-6">
            {/* Editor Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="flex flex-1 min-w-[220px] items-center gap-3">
                <label htmlFor="vault-filename" className="sr-only">
                  Tên tệp
                </label>
                <input
                  id="vault-filename"
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="ten_tep.py hoặc note.md"
                  className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 font-mono text-sm font-medium text-slate-100 focus:border-sky-400 focus:outline-none"
                />
                <span className="font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
                  {lineCount} dòng
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {activeFile?.encryptedPayload && (
                  <button
                    type="button"
                    onClick={() => setShowCipherPreview((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white whitespace-nowrap"
                  >
                    <Lock className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                    <span>{showCipherPreview ? 'Ẩn bản mã hóa' : 'Xem mã AES-256'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(content)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white whitespace-nowrap"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Sao chép</span>
                </button>

                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-60 whitespace-nowrap"
                >
                  <Save className="h-4 w-4" aria-hidden="true" />
                  <span>{saving ? 'Đang mã hóa & đồng bộ...' : 'Lưu & Đăng cộng đồng'}</span>
                </button>
              </div>
            </div>

            {/* Editor Textarea */}
            <div className="mt-4">
              <label htmlFor="vault-editor" className="sr-only">
                Trình soạn thảo mã và ghi chú
              </label>
              <textarea
                id="vault-editor"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={14}
                spellCheck={false}
                placeholder="Nhập mã Python (.py), ghi chú Markdown (.md), hoặc tài liệu kỹ thuật..."
                className="w-full rounded-xl border border-slate-800 bg-[#080C14] p-4 font-mono text-sm leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-sky-500/70 focus:outline-none"
              />
            </div>

            {/* AES-256 Ciphertext Inspection Drawer */}
            {showCipherPreview && activeFile?.encryptedPayload && (
              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4">
                <div className="flex items-center justify-between text-xs text-sky-400 font-medium">
                  <span>Bản mã hóa AES-256-GCM thực tế được lưu trữ</span>
                  <span className="font-mono text-slate-400">
                    IV: {activeFile.encryptedPayload.iv.slice(0, 12)}...
                  </span>
                </div>
                <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-slate-400">
                  {activeFile.encryptedPayload.ciphertext}
                </p>
              </div>
            )}

            {/* Pipeline Toggles */}
            <div className="mt-4 grid gap-3 sm:grid-cols-3 border-t border-slate-800 pt-4 text-xs">
              <label className="flex items-center gap-2.5 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={isEncrypted}
                  onChange={(e) => setIsEncrypted(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-400"
                />
                <span>Mã hóa AES-256-GCM</span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={dispatchWebhook}
                  onChange={(e) => setDispatchWebhook(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-400"
                />
                <span>Lưu trực tiếp trên Webhook</span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={isPublicCommunity}
                  onChange={(e) => setIsPublicCommunity(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-400"
                />
                <span>Đăng lên Cộng đồng ngay</span>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncToGitHub}
                  onChange={(e) => setSyncToGitHub(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-400"
                />
                <span>
                  Commit trực tiếp lên GitHub (
                  {user.githubConfig.owner && user.githubConfig.repo
                    ? `${user.githubConfig.owner}/${user.githubConfig.repo}`
                    : 'Cần cấu hình Repo & Token'}
                  )
                </span>
              </label>

              <button
                type="button"
                onClick={onOpenSyncHub}
                className="text-sky-400 hover:underline whitespace-nowrap"
              >
                Cấu hình GitHub & Webhook
              </button>
            </div>

            {feedback && (
              <div
                role={feedback.type === 'err' ? 'alert' : 'status'}
                className={`mt-4 flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-xs ${
                  feedback.type === 'ok'
                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                    : 'border-rose-500/40 bg-rose-950/40 text-rose-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{feedback.text}</span>
                </div>
                {feedback.type === 'ok' && (
                  <button
                    type="button"
                    onClick={onOpenCommunity}
                    className="font-semibold text-sky-300 hover:underline whitespace-nowrap"
                  >
                    Xem trên Cộng đồng
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Sync Receipts Strip for Active File */}
          {activeFile && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-[#0F1624] p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                  <Webhook className="h-4 w-4 text-sky-400" aria-hidden="true" />
                  <span>Trạng thái Webhook</span>
                </div>
                <p className="mt-2 font-mono text-xs text-slate-100 truncate">
                  {activeFile.syncStatus.webhook?.dispatched
                    ? `HTTP ${activeFile.syncStatus.webhook.statusCode} · ${activeFile.syncStatus.webhook.deliveryId}`
                    : activeFile.syncStatus.webhook?.error || 'Chưa đồng bộ Webhook'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0F1624] p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                  <GitBranch className="h-4 w-4 text-sky-400" aria-hidden="true" />
                  <span>Trạng thái GitHub</span>
                </div>
                <p className="mt-2 font-mono text-xs text-slate-100 truncate">
                  {activeFile.syncStatus.github?.synced
                    ? `Đã commit · ${activeFile.syncStatus.github.commitSha?.slice(0, 7)}`
                    : activeFile.syncStatus.github?.error || 'Chưa liên kết GitHub Repo'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0F1624] p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                  <Globe className="h-4 w-4 text-sky-400" aria-hidden="true" />
                  <span>Cộng đồng</span>
                </div>
                <p className="mt-2 font-mono text-xs text-slate-100 truncate">
                  {activeFile.syncStatus.community?.published
                    ? `Đã xuất bản (${activeFile.syncStatus.community.postId})`
                    : 'Chỉ lưu riêng tư'}
                </p>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}
