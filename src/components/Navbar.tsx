import { LogOut, Plus, ShieldCheck } from 'lucide-react';
import type { AuthUser } from '../types';

export type AppSection = 'auth' | 'vault' | 'community' | 'sync';

interface NavbarProps {
  activeSection: AppSection;
  onNavigate: (section: AppSection) => void;
  user: AuthUser | null;
  onNewFile: () => void;
  onLogout: () => void;
}

export function Navbar({
  activeSection,
  onNavigate,
  user,
  onNewFile,
  onLogout,
}: NavbarProps) {
  const navItems: Array<{ id: AppSection; label: string }> = [
    { id: 'vault', label: 'Kho lưu trữ' },
    { id: 'community', label: 'Cộng đồng' },
    { id: 'sync', label: 'GitHub & Webhook' },
    { id: 'auth', label: user ? 'Hồ sơ 3D' : 'Face ID 3D' },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#080C14]/95">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-8 px-4 sm:px-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onNavigate(user ? 'vault' : 'auth')}
          className="font-display flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded-md px-1"
        >
          <ShieldCheck className="h-5 w-5 text-sky-400 shrink-0" aria-hidden="true" />
          <span>AegisVault</span>
        </button>

        {/* Zone 2: Clean single-line navigation links */}
        <nav
          aria-label="Điều hướng chính"
          className="hidden md:flex items-center gap-6 text-sm font-medium"
        >
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative py-1 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded ${
                  isActive
                    ? 'text-sky-400'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[21px] h-0.5 bg-sky-400"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <>
              <button
                type="button"
                onClick={onNewFile}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-400 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Tạo tệp mới</span>
              </button>
              <button
                type="button"
                onClick={onLogout}
                aria-label="Đăng xuất"
                title="Đăng xuất"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 transition-colors hover:border-slate-700 hover:text-white shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('auth')}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-400 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              <span>Đăng nhập Face ID</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile compact single-row nav */}
      <nav
        aria-label="Điều hướng di động"
        className="flex md:hidden items-center justify-around border-t border-slate-800/80 px-2 py-2 text-xs font-medium"
      >
        {navItems.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`px-2 py-1.5 rounded-md whitespace-nowrap shrink-0 transition-colors ${
                isActive ? 'bg-slate-800 text-sky-400' : 'text-slate-400'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
