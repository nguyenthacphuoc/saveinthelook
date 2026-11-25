import { useState } from 'react';
import { motion } from 'motion/react';
import {
  Code2,
  Copy,
  FileText,
  GitFork,
  Heart,
  Search,
  X,
} from 'lucide-react';
import type { AuthUser, CommunityPost, VaultFileType } from '../types';

interface CommunityFeedProps {
  posts: CommunityPost[];
  user: AuthUser | null;
  token: string | null;
  onLikePost: (postId: string) => void;
  onForkSuccess: () => void;
  onRequireAuth: () => void;
}

export function CommunityFeed({
  posts,
  user,
  token,
  onLikePost,
  onForkSuccess,
  onRequireAuth,
}: CommunityFeedProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | VaultFileType>('all');
  const [selectedPost, setSelectedPost] = useState<CommunityPost | null>(null);
  const [forkNotice, setForkNotice] = useState<string | null>(null);

  const filtered = posts.filter((post) => {
    const matchFilter = filter === 'all' || post.fileType === filter;
    const q = query.trim().toLowerCase();
    const matchQuery =
      !q ||
      post.filename.toLowerCase().includes(q) ||
      post.authorDisplayName.toLowerCase().includes(q) ||
      post.content.toLowerCase().includes(q);
    return matchFilter && matchQuery;
  });

  const handleFork = async (post: CommunityPost) => {
    if (!user || !token) {
      onRequireAuth();
      return;
    }
    const resp = await fetch(`/api/community/${post.id}/fork`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      setForkNotice(`Đã sao chép "${post.filename}" về kho lưu trữ của bạn.`);
      onForkSuccess();
    }
  };

  return (
    <section className="mx-auto max-w-[1320px] px-4 py-8 sm:px-8 space-y-6">
      {/* Header & Filter Controls */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-50 text-balance">
            Cộng đồng Mã & Ghi chú
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Mỗi tệp Python hoặc ghi chú khi lưu công khai sẽ xuất hiện trực tiếp tại đây cùng biên nhận Webhook.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm script, ghi chú, tác giả..."
              aria-label="Tìm bài đăng cộng đồng"
              className="w-60 rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1 border border-slate-800">
            {(
              [
                { id: 'all', label: 'Tất cả' },
                { id: 'py', label: 'Python (.py)' },
                { id: 'md', label: 'Ghi chú (.md)' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  filter === tab.id
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {forkNotice && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-4 py-2.5 text-xs text-emerald-200 flex items-center justify-between"
        >
          <span>{forkNotice}</span>
          <button
            type="button"
            onClick={() => setForkNotice(null)}
            aria-label="Đóng thông báo"
            className="text-emerald-300 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Community Cards Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-[#0F1624] p-12 text-center">
          <p className="text-sm text-slate-300">Không có tệp cộng đồng nào khớp từ khóa.</p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((post) => (
            <motion.article
              key={post.id}
              initial={{ y: 6 }}
              animate={{ y: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="flex flex-col justify-between rounded-xl border border-slate-800 bg-[#0F1624] p-5 transition-colors hover:border-slate-700"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {post.fileType === 'py' ? (
                        <Code2 className="h-4 w-4 text-sky-400 shrink-0" aria-hidden="true" />
                      ) : (
                        <FileText className="h-4 w-4 text-slate-300 shrink-0" aria-hidden="true" />
                      )}
                      <h2 className="truncate font-mono text-sm font-semibold text-slate-100">
                        {post.filename}
                      </h2>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {post.authorDisplayName} <span aria-hidden="true">·</span> .{post.fileType}{' '}
                      <span aria-hidden="true">·</span>{' '}
                      <span className="tabular-nums">{post.content.split('\n').length} dòng</span>
                    </p>
                  </div>
                </div>

                <pre className="mt-4 h-36 overflow-hidden rounded-lg border border-slate-800/80 bg-[#080C14] p-3 font-mono text-xs leading-relaxed text-slate-300">
                  <code>{post.content.slice(0, 360)}</code>
                </pre>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-xs">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onLikePost(post.id)}
                    aria-label={`Thích ${post.filename}`}
                    className="inline-flex items-center gap-1 text-slate-400 hover:text-rose-400 transition-colors tabular-nums"
                  >
                    <Heart className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{post.likes}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFork(post)}
                    aria-label={`Sao chép ${post.filename} về kho`}
                    className="inline-flex items-center gap-1 text-slate-400 hover:text-sky-400 transition-colors tabular-nums"
                  >
                    <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{post.forks}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedPost(post)}
                  className="font-semibold text-sky-400 hover:text-sky-300 whitespace-nowrap"
                >
                  Xem mã nguồn
                </button>
              </div>
            </motion.article>
          ))}
        </div>
      )}

      {/* Inspect Modal */}
      {selectedPost && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="community-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div className="w-full max-w-3xl rounded-xl border border-slate-700 bg-[#0F1624] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h2
                  id="community-modal-title"
                  className="font-mono text-lg font-bold text-slate-50"
                >
                  {selectedPost.filename}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Tác giả: {selectedPost.authorDisplayName} (@{selectedPost.authorUsername}) ·
                  SHA-256: {selectedPost.contentHash.slice(0, 16)}...
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPost(null)}
                aria-label="Đóng cửa sổ xem mã"
                className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <pre className="mt-4 max-h-[420px] overflow-auto rounded-xl border border-slate-800 bg-[#080C14] p-4 font-mono text-xs leading-relaxed text-slate-200">
              <code>{selectedPost.content}</code>
            </pre>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(selectedPost.content)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:text-white"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sao chép nội dung</span>
              </button>
              <button
                type="button"
                onClick={() => handleFork(selectedPost)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Lưu về kho cá nhân</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
