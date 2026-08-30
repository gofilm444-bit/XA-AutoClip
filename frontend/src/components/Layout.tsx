import { type ReactNode, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useBlankManualEditor } from "../hooks/useBlankManualEditor";

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
  const editorMode = location.pathname.startsWith("/transformations/");
  const [editorToolbar, setEditorToolbar] = useState<EditorToolbarConfig | null>(null);
  const blankEditor = useBlankManualEditor();
  const outletContext = useMemo<LayoutOutletContext>(
    () => ({ setEditorToolbar }),
    [],
  );

  if (focusMode) {
    return (
      <div className={editorMode ? "editor-shell min-h-screen bg-[#101214] text-zinc-100" : "min-h-screen bg-[#f7f8fc] text-slate-900"}>
        <header className={`editor-topbar sticky top-0 z-50 border-b backdrop-blur ${
          editorMode
            ? "border-zinc-800 bg-[#17191c]/95 shadow-sm"
            : "border-slate-200 bg-white/95 shadow-sm"
        }`}>
          <div className={`flex items-center gap-2 sm:gap-3 ${
            editorMode ? "h-11 px-3 sm:px-4" : "h-16 px-4 sm:px-7"
          }`}>
            <Link
              to="/"
              className={`flex shrink-0 items-center gap-1.5 font-bold ${
                editorMode ? "text-xs text-zinc-300 hover:text-cyan-300" : "text-sm text-slate-700 hover:text-violet-700"
              }`}
            >
              <span className={editorMode ? "text-lg leading-none" : "text-2xl leading-none"}>{"<"}</span>
              <span className="hidden sm:inline">Kembali</span>
            </Link>
            {editorToolbar && (
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <div className="flex min-w-0 items-center justify-center gap-2 sm:justify-start">
                  <p className={`min-w-0 truncate font-black ${
                    editorMode ? "text-xs sm:text-sm text-zinc-100" : "text-sm sm:text-base text-slate-950"
                  }`}>
                    {editorToolbar.title}
                  </p>
                  {editorToolbar.badge}
                </div>
                {editorToolbar.meta && (
                  <p className={`truncate font-semibold ${
                    editorMode ? "text-[10px] text-zinc-500" : "mt-0.5 text-[11px] sm:text-xs text-slate-500"
                  }`}>
                    {editorToolbar.meta}
                  </p>
                )}
              </div>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
              {editorToolbar?.actions && (
                <div className="hidden items-center gap-1.5 lg:flex">{editorToolbar.actions}</div>
              )}
              {editorToolbar?.compactActions && (
                <details className="relative lg:hidden">
                  <summary className="btn-secondary list-none px-2.5 py-1 text-xs">Aksi</summary>
                  <div className="absolute right-0 top-10 z-50 w-52 space-y-1.5 rounded-xl border border-zinc-700 bg-zinc-900 p-2.5 shadow-xl">
                    {editorToolbar.compactActions}
                  </div>
                </details>
              )}
              <Link to="/" className={`hidden font-black tracking-tight sm:block ${
                editorMode ? "text-sm" : "text-lg"
              }`}>
                <span className={editorMode ? "text-cyan-400" : "text-violet-600"}>XA</span> AutoClip
              </Link>
            </div>
          </div>
        </header>
        <main className={editorMode ? "editor-main w-full p-1 sm:p-1.5" : "mx-auto max-w-[1540px] px-4 py-7 sm:px-7 lg:px-10"}>
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
          <button
            type="button"
            onClick={() => blankEditor.mutate()}
            className={`workspace-link ${
              location.pathname === "/projects/new" && !location.search.includes("mode=autoclip")
                ? "workspace-link-active"
                : ""
            }`}
          >
            <span>+</span>
            Mulai Edit
          </button>
          <Link
            to="/projects/new?mode=autoclip"
            className={`workspace-link ${
              location.pathname === "/projects/new" && location.search.includes("mode=autoclip")
                ? "workspace-link-active"
                : ""
            }`}
          >
            <span>AI</span>
            Buat AutoClip
          </Link>
        </nav>
        <div className="mt-8 border-t border-zinc-800 pt-6">
          <p className="px-3 text-xs font-bold uppercase tracking-[0.2em] text-zinc-600">
            Alur kerja
          </p>
          <ol className="mt-4 space-y-3 px-3 text-sm text-zinc-500">
            <li>1. Upload atau paste link video</li>
            <li>2. Atur timeline dan elemen</li>
            <li>3. Export hasil edit</li>
          </ol>
        </div>
        <div className="mt-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm font-bold">Video editing workspace</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Edit manual sebagai alur utama, AutoClip tetap tersedia.
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
