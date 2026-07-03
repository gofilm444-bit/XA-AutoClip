import { type ReactNode, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

export type EditorToolbarConfig = {
  actions?: ReactNode;
  badge?: ReactNode;
  compactActions?: ReactNode;
  meta?: ReactNode;
  title?: ReactNode;
};

export type LayoutOutletContext = {
  setEditorToolbar: (toolbar: EditorToolbarConfig | null) => void;
};

export function Layout() {
  const location = useLocation();
  const focusMode = location.pathname !== "/";
  const [editorToolbar, setEditorToolbar] = useState<EditorToolbarConfig | null>(null);
  const outletContext = useMemo<LayoutOutletContext>(
    () => ({ setEditorToolbar }),
    [],
  );

  if (focusMode) {
    return (
      <div className="min-h-screen bg-[#f7f8fc] text-slate-900">
        <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-7">
            <Link
              to="/"
              className="flex shrink-0 items-center gap-2 font-bold text-slate-700 hover:text-violet-700"
            >
              <span className="text-2xl leading-none">{"<"}</span>
              <span className="hidden sm:inline">Kembali ke beranda</span>
            </Link>
            {editorToolbar && (
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <div className="flex min-w-0 items-center justify-center gap-2 sm:justify-start">
                  <p className="min-w-0 truncate text-sm font-black text-slate-950 sm:text-base">
                    {editorToolbar.title}
                  </p>
                  {editorToolbar.badge}
                </div>
                {editorToolbar.meta && (
                  <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500 sm:text-xs">
                    {editorToolbar.meta}
                  </p>
                )}
              </div>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-3">
              {editorToolbar?.actions && (
                <div className="hidden items-center gap-2 lg:flex">{editorToolbar.actions}</div>
              )}
              {editorToolbar?.compactActions && (
                <details className="relative lg:hidden">
                  <summary className="btn-secondary list-none px-3 py-2 text-sm">Aksi</summary>
                  <div className="absolute right-0 top-11 z-50 w-56 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                    {editorToolbar.compactActions}
                  </div>
                </details>
              )}
              <Link to="/" className="hidden text-lg font-black tracking-tight sm:block">
                <span className="text-violet-600">XA</span> AutoClip
              </Link>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1540px] px-4 py-7 sm:px-7 lg:px-10">
          <Outlet context={outletContext} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden border-r border-zinc-800 bg-zinc-950 lg:flex lg:min-h-screen lg:flex-col lg:p-5">
        <Link to="/" className="px-2 text-xl font-black tracking-tight">
          <span className="text-cyan-400">XA</span> AutoClip
        </Link>
        <Link to="/projects/new" className="btn mt-7 w-full">
          + Proyek baru
        </Link>
        <nav className="mt-7 space-y-2">
          <NavLink
            end
            to="/"
            className={({ isActive }) =>
              `workspace-link ${isActive ? "workspace-link-active" : ""}`
            }
          >
            <span>P</span>
            Proyek saya
          </NavLink>
          <NavLink
            to="/projects/new"
            className={({ isActive }) =>
              `workspace-link ${isActive ? "workspace-link-active" : ""}`
            }
          >
            <span>+</span>
            Upload Baru
          </NavLink>
        </nav>
        <div className="mt-8 border-t border-zinc-800 pt-6">
          <p className="px-3 text-xs font-bold uppercase tracking-[0.2em] text-zinc-600">
            Alur kerja
          </p>
          <ol className="mt-4 space-y-3 px-3 text-sm text-zinc-500">
            <li>1. Paste link dan upload video</li>
            <li>2. Simpan 5 klip terbaik</li>
            <li>3. Edit dan render per klip</li>
          </ol>
        </div>
        <div className="mt-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm font-bold">AI clipping workspace</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Dari video panjang menjadi klip vertikal siap ditinjau.
          </p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <Link to="/" className="text-xl font-black tracking-tight">
              <span className="text-cyan-400">XA</span> AutoClip
            </Link>
            <Link to="/projects/new" className="btn">Proyek baru</Link>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet context={outletContext} />
        </main>
      </div>
    </div>
  );
}
