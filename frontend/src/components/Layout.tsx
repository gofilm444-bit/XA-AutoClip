import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

export function Layout() {
  const location = useLocation();
  const focusMode = location.pathname !== "/";

  if (focusMode) {
    return (
      <div className="min-h-screen bg-[#f7f8fc] text-slate-900">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center justify-between px-4 sm:px-7">
            <Link to="/" className="flex items-center gap-3 font-bold text-slate-700">
              <span className="text-2xl leading-none">{"<"}</span>
              <span>Kembali ke beranda</span>
            </Link>
            <Link to="/" className="text-lg font-black tracking-tight">
              <span className="text-violet-600">XA</span> AutoClip
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-[1540px] px-4 py-7 sm:px-7 lg:px-10">
          <Outlet />
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
            Buat klip AI
          </NavLink>
        </nav>
        <div className="mt-8 border-t border-zinc-800 pt-6">
          <p className="px-3 text-xs font-bold uppercase tracking-[0.2em] text-zinc-600">
            Alur kerja
          </p>
          <ol className="mt-4 space-y-3 px-3 text-sm text-zinc-500">
            <li>1. Paste link dan upload video</li>
            <li>2. Pilih klip</li>
            <li>3. Editing klip</li>
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}
