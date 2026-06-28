import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, sourceVideoUrl } from "../api/client";
import { WorkflowSteps } from "../components/WorkflowSteps";
import type { Candidate, Project, Transformation } from "../types";

type Status = {
  project_id: string;
  job_id?: string;
  status: string;
  progress: number;
  current_step: string;
  error_code?: string;
  error_message?: string;
};

const processing = new Set([
  "created",
  "uploading",
  "uploaded",
  "extracting_metadata",
  "extracting_audio",
  "transcribing",
  "segmenting",
  "generating_candidates",
]);

const processingStages = [
  { label: "Upload video", at: 5 },
  { label: "Membuat proyek", at: 12 },
  { label: "Memproses video", at: 28 },
  { label: "Mencari bagian terbaik", at: 55 },
  { label: "Menyiapkan klip", at: 85 },
  { label: "Selesai", at: 100 },
];

function formatTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

export function ProjectPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedCandidateId, setSelectedCandidateId] = useState("");

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<Project>(`/api/projects/${projectId}`),
  });
  const status = useQuery({
    queryKey: ["status", projectId],
    queryFn: () => api<Status>(`/api/projects/${projectId}/status`),
    refetchInterval: (query) =>
      processing.has(query.state.data?.status || "") ? 2000 : false,
  });
  const candidates = useQuery({
    queryKey: ["candidates", projectId],
    queryFn: () => api<Candidate[]>(`/api/projects/${projectId}/candidates`),
    enabled: status.data?.status === "candidates_ready",
  });
  const latestTransformation = useQuery({
    queryKey: ["latest-transformation", projectId],
    queryFn: () =>
      api<Transformation>(`/api/projects/${projectId}/latest-transformation`),
    enabled: Boolean(
      status.data &&
        !processing.has(status.data.status) &&
        status.data.status !== "candidates_ready" &&
        status.data.status !== "failed",
    ),
    retry: false,
  });

  useEffect(() => {
    if (latestTransformation.data) {
      navigate(`/transformations/${latestTransformation.data.id}`, { replace: true });
    }
  }, [latestTransformation.data, navigate]);

  useEffect(() => {
    if (!selectedCandidateId && candidates.data?.length) {
      setSelectedCandidateId(candidates.data[0].id);
    }
  }, [candidates.data, selectedCandidateId]);

  const choose = useMutation({
    mutationFn: async (candidate: Candidate) => {
      await api(`/api/candidates/${candidate.id}/select`, { method: "POST" });
      return api<{ id: string }>(
        `/api/candidates/${candidate.id}/transformation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            purpose: "analysis",
            audience: "Kreator konten Indonesia",
          }),
        },
      );
    },
    onSuccess: (plan) => navigate(`/transformations/${plan.id}`),
  });

  const retry = useMutation({
    mutationFn: () =>
      api(`/api/jobs/${status.data?.job_id}/retry`, { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([status.refetch(), project.refetch()]);
    },
  });
  const regenerateCopy = useMutation({
    mutationFn: (candidate: Candidate) =>
      api<Candidate>(`/api/candidates/${candidate.id}/regenerate-copy`, {
        method: "POST",
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Candidate[]>(
        ["candidates", projectId],
        (current) =>
          current?.map((candidate) =>
            candidate.id === updated.id ? updated : candidate,
          ),
      );
    },
  });

  if (project.isLoading || status.isLoading) {
    return <p className="py-20 text-center text-slate-500">Memuat proyek...</p>;
  }
  if (project.error || status.error) {
    return <p className="py-20 text-center text-red-600">Proyek tidak dapat dimuat.</p>;
  }

  if (status.data?.status === "failed") {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="text-5xl">!</div>
        <h1 className="mt-4 text-2xl font-black text-red-700">Pemrosesan gagal</h1>
        <p className="mt-3 text-slate-600">{status.data.error_message}</p>
        {status.data.job_id && (
          <button
            className="btn mt-6"
            disabled={retry.isPending}
            onClick={() => retry.mutate()}
          >
            {retry.isPending ? "Menjalankan ulang..." : "Coba proses lagi"}
          </button>
        )}
      </div>
    );
  }

  if (status.data?.status !== "candidates_ready") {
    const progress = status.data?.progress || 0;
    return (
      <div className="space-y-8">
        <WorkflowSteps current={2} />
        <div className="mx-auto grid max-w-6xl gap-8 pt-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="flex min-h-[610px] flex-col justify-center">
            <div className="max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-2xl text-white">
                  PLAY
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{project.data?.title}</p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    Upload selesai - AI memproses {progress}%
                  </p>
                </div>
              </div>
            </div>

            <h1 className="mt-10 text-3xl font-black">
              {project.data?.content_type === "sports"
                ? "Menganalisis pertandingan dan mencari momen seru"
                : "Menganalisis percakapan dan mencari klip"}
            </h1>
            <p className="mt-3 max-w-xl text-lg text-slate-500">
              Anda dapat meninggalkan halaman ini. Proses tetap berjalan sampai
              kandidat klip siap.
            </p>

            <ol className="mt-8 space-y-4">
              {processingStages.map((stage) => {
                const done = progress >= stage.at;
                const active =
                  !done &&
                  processingStages.find((item) => progress < item.at)?.label === stage.label;
                return (
                  <li
                    className={`flex items-center gap-4 text-lg ${
                      done
                        ? "text-slate-900"
                        : active
                          ? "font-semibold text-violet-700"
                          : "text-slate-400"
                    }`}
                    key={stage.label}
                  >
                    <span
                      className={`flex size-6 items-center justify-center rounded-full border-2 text-xs ${
                        done
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : active
                            ? "animate-pulse border-violet-600"
                            : "border-slate-300"
                      }`}
                    >
                      {done ? "OK" : ""}
                    </span>
                    <span>{active ? `${stage.label}... ${progress}%` : stage.label}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          <aside className="hidden rounded-3xl border border-slate-200 bg-white p-8 shadow-lg lg:block">
            <div className="grid grid-cols-6 gap-1">
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <span
                  className={`h-1 rounded ${item === 0 ? "bg-violet-500" : "bg-slate-200"}`}
                  key={item}
                />
              ))}
            </div>
            <p className="mt-10 text-sm">Tutorial</p>
            <h2 className="mt-2 text-2xl font-black">
              Ubah video panjang menjadi short dalam sekali proses
            </h2>
            <div className="mt-6 flex aspect-video items-center justify-center rounded-2xl bg-slate-100 text-6xl text-violet-300">
              AI
            </div>
            <p className="mt-6 leading-7 text-slate-600">
              {project.data?.content_type === "sports"
                ? "AI membaca lonjakan sorakan, intensitas komentator, dan perubahan adegan untuk menemukan peluang, gol, selebrasi, atau insiden penting."
                : "AI mentranskripsikan video, menemukan gagasan terbaik, lalu menyiapkan kandidat klip vertikal yang dapat langsung Anda edit."}
            </p>
          </aside>
        </div>
      </div>
    );
  }

  const selected =
    candidates.data?.find((candidate) => candidate.id === selectedCandidateId) ||
    candidates.data?.[0];

  if (!selected) {
    return <p className="py-20 text-center text-slate-500">Memuat kandidat klip...</p>;
  }

  return (
    <div className="space-y-7">
      <WorkflowSteps current={2} />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="max-w-4xl text-2xl font-black">{project.data?.title}</h1>
          <p className="mt-1 text-slate-500">
            {candidates.data?.length || 0} klip ditemukan - pilih satu untuk diedit
          </p>
        </div>
        <div className="flex gap-3">
          <button className="btn-secondary">Filter</button>
          <select className="w-auto min-w-44">
            <option>Skor tertinggi</option>
            <option>Urutan waktu</option>
          </select>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <span className="rounded-lg bg-violet-100 px-3 py-2 font-bold text-violet-700">
          1 dipilih
        </span>
        <button
          className="btn"
          disabled={choose.isPending}
          onClick={() => choose.mutate(selected)}
        >
          {choose.isPending ? "Membuka editor..." : "Edit klip"}
        </button>
        <span className="ml-auto text-sm text-slate-500">
          Tahap berikutnya: editing dan render
        </span>
      </div>

      <div className="grid gap-5">
        {candidates.data?.map((candidate) => {
          const active = candidate.id === selected.id;
          return (
            <article
              className={`grid cursor-pointer gap-6 rounded-3xl border-2 bg-white p-3 shadow-sm transition md:grid-cols-[330px_minmax(0,1fr)] ${
                active
                  ? "border-violet-500 ring-4 ring-violet-100"
                  : "border-transparent hover:border-slate-300"
              }`}
              key={candidate.id}
              onClick={() => setSelectedCandidateId(candidate.id)}
            >
              <div className="relative mx-auto aspect-[9/16] w-full max-w-[330px] overflow-hidden rounded-2xl bg-black">
                <video
                  className="h-full w-full object-cover"
                  controls
                  preload="metadata"
                  src={`${sourceVideoUrl(projectId)}#t=${candidate.start_seconds},${candidate.end_seconds}`}
                />
                <span className="absolute bottom-4 left-4 rounded-lg bg-black/70 px-3 py-1 text-sm font-bold text-white">
                  {formatTime(candidate.duration_seconds)}
                </span>
              </div>

              <div className="p-3 md:py-6 md:pr-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-violet-600">
                      Peringkat #{candidate.rank}
                    </p>
                    <h2 className="mt-2 text-2xl font-black">
                      {candidate.suggested_title}
                    </h2>
                    <button
                      type="button"
                      className="mt-3 text-sm font-bold text-violet-700 underline"
                      disabled={
                        regenerateCopy.isPending &&
                        regenerateCopy.variables?.id === candidate.id
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        regenerateCopy.mutate(candidate);
                      }}
                    >
                      {regenerateCopy.isPending &&
                      regenerateCopy.variables?.id === candidate.id
                        ? "Menganalisis momen..."
                        : "Buat ulang judul AI"}
                    </button>
                  </div>
                  <div className="text-right">
                    <strong className="text-5xl font-black">
                      {(candidate.viral_potential_score / 10).toFixed(1)}
                    </strong>
                    <span className="text-slate-400">/10</span>
                    <p className="mt-1 text-xs font-bold uppercase text-slate-400">
                      Potensi klip
                    </p>
                  </div>
                </div>

                <p className="mt-5 font-semibold text-slate-700">
                  {candidate.suggested_hook}
                </p>
                <p className="mt-3 leading-7 text-slate-500">{candidate.summary}</p>

                <div className="mt-6 rounded-2xl bg-slate-50 p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    Transkrip suara
                  </p>
                  {candidate.transcript_text &&
                  project.data?.transcript_provider !== "mock" ? (
                    <p className="mt-3 line-clamp-8 whitespace-pre-line leading-7 text-slate-700">
                      {project.data?.content_type === "sports"
                        ? candidate.transcript_text
                        : `[${formatTime(candidate.start_seconds)}] ${candidate.transcript_text}`}
                    </p>
                  ) : (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                      Transkrip suara belum tersedia. Aktifkan OpenAI Speech-to-Text,
                      lalu proses ulang video untuk menampilkan ucapan komentator
                      beserta timestamp.
                    </div>
                  )}
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  {candidate.reasons_json.slice(0, 3).map((reason) => (
                    <span
                      className="rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-700"
                      key={reason}
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {choose.error && <p className="text-red-600">{choose.error.message}</p>}
      {regenerateCopy.error && (
        <p className="text-red-600">{regenerateCopy.error.message}</p>
      )}
    </div>
  );
}
