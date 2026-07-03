import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Project } from "../types";

const statusLabels: Record<string, string> = {
  created: "Baru",
  uploaded: "Video terunggah",
  extracting_metadata: "Membaca metadata",
  extracting_audio: "Mengekstrak audio",
  transcribing: "Membuat transkrip",
  generating_candidates: "Menganalisis kandidat",
  candidates_ready: "Kandidat siap",
  transformation_draft: "Draft transformasi",
  originality_review: "Penilaian originalitas",
  ready_to_render: "Siap render",
  preview_ready: "Preview siap",
  completed: "Selesai",
  failed: "Gagal",
};

function formatDuration(value?: number | null) {
  if (!value) return "-";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatSize(value?: number) {
  if (!value) return "-";
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function DashboardPage() {
  const client = useQueryClient();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/api/projects"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-3xl border border-cyan-900/50 bg-gradient-to-br from-cyan-950/70 via-zinc-900 to-zinc-950 p-6 sm:p-8">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <p className="font-semibold uppercase tracking-[0.25em] text-cyan-400">
              AI clipping studio
            </p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black leading-tight sm:text-5xl">
              Satu video panjang, banyak klip siap publikasi.
            </h1>
            <p className="mt-4 max-w-2xl text-zinc-300">
              Upload video, biarkan engine mencari momen terbaik, lalu edit
              subtitle, caption, framing, dan hasil akhir dalam satu workspace.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link className="btn px-6 py-3" to="/projects/new">
                Buat klip dari video
              </Link>
              <a className="btn-secondary px-6 py-3" href="#recent-projects">
                Lihat proyek
              </a>
            </div>
          </div>
          <div className="studio-card p-5">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Workflow otomatis
            </p>
            <div className="mt-4 space-y-3">
              {[
                ["01", "Paste link dan upload video"],
                ["02", "Pilih klip"],
                ["03", "Editing klip terpilih"],
              ].map(([number, label]) => (
                <div
                  className="flex items-center gap-3 rounded-xl bg-zinc-950/80 p-3"
                  key={number}
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-cyan-400 font-black text-zinc-950">
                    {number}
                  </span>
                  <span className="text-sm font-semibold">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div id="recent-projects" className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-cyan-400">Workspace</p>
          <h2 className="mt-1 text-2xl font-black">Riwayat hasil proses</h2>
        </div>
        <Link className="btn-secondary" to="/projects/new">+ Proyek baru</Link>
      </div>
      {projects.isLoading && <p>Memuat proyek...</p>}
      {projects.error && <p className="text-red-300">{projects.error.message}</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.data?.map((project) => (
          <article key={project.id} className="studio-card p-5 transition hover:border-zinc-600">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-4 flex aspect-video items-center justify-center rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-950 text-3xl font-black text-cyan-400">
                  XA
                </div>
                <h3 className="line-clamp-2 text-lg font-bold">{project.title}</h3>
                <p className="mt-1 text-sm text-zinc-400">
                  {new Date(project.created_at).toLocaleString("id-ID")}
                </p>
              </div>
              <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-cyan-300">
                {statusLabels[project.status] || project.status}
              </span>
            </div>
            <p className="mt-4 line-clamp-2 min-h-10 text-sm text-zinc-400">
              {project.description || "Tanpa deskripsi"}
            </p>
            <div className="mt-5 flex gap-3 border-t border-zinc-800 pt-4">
              <Link className="btn flex-1" to={`/jobs/${project.id}/clips`}>Buka</Link>
              <button className="btn-secondary" onClick={() => remove.mutate(project.id)}>
                Hapus
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-zinc-800 pt-4 text-xs text-zinc-400">
              <span>Durasi: {formatDuration(project.original_duration)}</span>
              <span>Top clips: {project.total_top_clips || 0}/5</span>
              <span>Final: {project.final_clips_count || 0}</span>
              <span>Storage: {formatSize(project.storage_size_estimate)}</span>
            </div>
          </article>
        ))}
      </div>
      {!projects.isLoading && projects.data?.length === 0 && (
        <div className="panel text-center">
          <p className="text-zinc-400">Belum ada proyek.</p>
          <Link className="btn mt-4" to="/projects/new">Buat proyek pertama</Link>
        </div>
      )}
    </div>
  );
}
