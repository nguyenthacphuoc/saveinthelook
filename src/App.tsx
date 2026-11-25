import { useCallback, useEffect, useState } from 'react';
import type {
  AuthUser,
  CommunityPost,
  VaultFileRecord,
  WebhookDeliveryLog,
} from './types';
import { Navbar, type AppSection } from './components/Navbar';
import { FaceAuthGateway } from './components/FaceAuthGateway';
import { VaultWorkspace } from './components/VaultWorkspace';
import { CommunityFeed } from './components/CommunityFeed';
import { GitHubWebhookHub } from './components/GitHubWebhookHub';

export default function App() {
  const [activeSection, setActiveSection] = useState<AppSection>('auth');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [passphrase, setPassphrase] = useState<string>('');
  const [files, setFiles] = useState<VaultFileRecord[]>([]);
  const [communityPosts, setCommunityPosts] = useState<CommunityPost[]>([]);
  const [webhookLogs, setWebhookLogs] = useState<WebhookDeliveryLog[]>([]);

  const fetchCommunity = useCallback(async () => {
    try {
      const resp = await fetch('/api/community');
      if (resp.ok) {
        const data = (await resp.json()) as { posts: CommunityPost[] };
        setCommunityPosts(data.posts || []);
      }
    } catch {
      // Ignore transient network errors during initial load
    }
  }, []);

  const fetchVaultAndLogs = useCallback(async (authToken: string) => {
    try {
      const [filesResp, logsResp] = await Promise.all([
        fetch('/api/files', {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch('/api/webhooks/logs', {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);
      if (filesResp.ok) {
        const fData = (await filesResp.json()) as { files: VaultFileRecord[] };
        setFiles(fData.files || []);
      }
      if (logsResp.ok) {
        const lData = (await logsResp.json()) as { logs: WebhookDeliveryLog[] };
        setWebhookLogs(lData.logs || []);
      }
    } catch {
      // Ignore transient errors
    }
  }, []);

  useEffect(() => {
    fetchCommunity();
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      setActiveSection('community');
    }
  }, [fetchCommunity]);

  const handleAuthenticated = async (payload: {
    token: string;
    user: AuthUser;
    passphrase: string;
  }) => {
    setToken(payload.token);
    setUser(payload.user);
    setPassphrase(payload.passphrase);
    await Promise.all([fetchVaultAndLogs(payload.token), fetchCommunity()]);
    setActiveSection('vault');
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setPassphrase('');
    setFiles([]);
    setWebhookLogs([]);
    setActiveSection('auth');
  };

  const handleLikePost = async (postId: string) => {
    const resp = await fetch(`/api/community/${postId}/like`, { method: 'POST' });
    if (resp.ok) {
      const data = (await resp.json()) as { post: CommunityPost };
      setCommunityPosts((prev) =>
        prev.map((p) => (p.id === postId ? data.post : p)),
      );
    }
  };

  const handleNavigate = (section: AppSection) => {
    if (section === 'vault' && !user) {
      setActiveSection('auth');
      return;
    }
    setActiveSection(section);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#080C14] text-slate-100">
      <Navbar
        activeSection={activeSection}
        onNavigate={handleNavigate}
        user={user}
        onNewFile={() => setActiveSection('vault')}
        onLogout={handleLogout}
      />

      <main className="flex-1">
        {activeSection === 'auth' && (
          <FaceAuthGateway
            user={user}
            onAuthenticated={handleAuthenticated}
            onGoToVault={() => setActiveSection('vault')}
          />
        )}

        {activeSection === 'vault' && user && token && (
          <VaultWorkspace
            token={token}
            user={user}
            passphrase={passphrase}
            files={files}
            onFilesChanged={setFiles}
            onSyncCompleted={() => {
              fetchCommunity();
              fetchVaultAndLogs(token);
            }}
            onOpenSyncHub={() => setActiveSection('sync')}
            onOpenCommunity={() => setActiveSection('community')}
          />
        )}

        {activeSection === 'community' && (
          <CommunityFeed
            posts={communityPosts}
            user={user}
            token={token}
            onLikePost={handleLikePost}
            onForkSuccess={() => {
              if (token) fetchVaultAndLogs(token);
              fetchCommunity();
            }}
            onRequireAuth={() => setActiveSection('auth')}
          />
        )}

        {activeSection === 'sync' && (
          <GitHubWebhookHub
            user={user}
            token={token}
            webhookLogs={webhookLogs}
            onUserUpdated={setUser}
            onLogsRefreshed={() => {
              if (token) fetchVaultAndLogs(token);
            }}
            onRequireAuth={() => setActiveSection('auth')}
          />
        )}
      </main>

      <footer className="border-t border-slate-800/80 py-5 text-center text-xs text-slate-500">
        AegisVault · Lưu trữ mã & ghi chú mã hóa AES-256-GCM · Xác thực Face ID 360° & Đối chiếu 3D
      </footer>
    </div>
  );
}
