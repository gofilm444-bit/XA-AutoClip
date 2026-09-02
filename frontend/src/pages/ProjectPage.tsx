import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, candidateVideoUrl, downloadUrl, sourceVideoUrl } from "../api/client";
import { WorkflowSteps } from "../components/WorkflowSteps";
import type { Candidate, Project, ProjectClip } from "../types";

type Status = {
  project_id: string;
  job_id?: string;
  status: string;
  progress: number;
  current_step: string;
  current_stage?: string;
  current_stage_label?: string;
  elapsed_seconds?: number | null;
  candidate_count?: number;
  stage_started_at?: string | null;
  last_update_at?: string | null;
  error_code?: string;
  error_message?: string;
  is_stale?: boolean;
  recovery_available?: boolean;
};

type CandidateSelection = {
  candidate_id: string;
  job_id: string;
  clip_id: string;
  transformation_id: string;
  status: "created" | "existing";
  message: string;
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
  { key: "upload", label: "Upload video selesai", at: 5 },
  { key: "create_project", label: "Membuat proyek", at: 10 },
  { key: "extract_audio", label: "Mengekstrak audio", at: 25 },
  { key: "transcribe", label: "Mentranskrip audio", sportsLabel: "Membaca komentar pertandingan", at: 45 },
  { key: "analyze", label: "Menganalisis percakapan", sportsLabel: "Menganalisis momen seru & sorakan", at: 65 },
  { key: "candidates", label: "Mencari kandidat klip", sportsLabel: "Mencari peluang & sorakan terbaik", at: 75 },
  { key: "copy", label: "Menyiapkan judul dan hook AI", at: 85 },
  { key: "clips_preview", label: "Membuat file preview kandidat", at: 92 },
  { key: "thumbnails", label: "Membuat thumbnail", at: 96 },
  { key: "editor_ready", label: "Menyiapkan editor", at: 99 },
  { key: "done", label: "Selesai", at: 100 },
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
  const [actionKey, setActionKey] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastProgressChangeSeconds, setLastProgressChangeSeconds] = useState(0);
  const [lastProgressValue, setLastProgressValue] = useState<number | null>(null);
  const [lastStepValue, setLastStepValue] = useState<string | null>(null);
  const [manualLoadingClips, setManualLoadingClips] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<Project>(`/api/projects/${projectId}`),
    refetchInterval: (query) => {
      const statusStr = query.state.data?.status || "";
      return processing.has(statusStr) ? 4000 : false;
    },
  });
  const status = useQuery({
    queryKey: ["status", projectId],
    queryFn: () => api<Status>(`/api/projects/${projectId}/status`),
    refetchInterval: (query) => {
      const statusStr = query.state.data?.status || "";
      return processing.has(statusStr) ? 2000 : false;
    },
  });

  const isFailed = status.data?.status === "failed" || project.data?.status === "failed";

  const isCompletedOrReady = Boolean(
    !isFailed && (
      (status.data && !processing.has(status.data.status)) ||
      (project.data && !processing.has(project.data.status)) ||
      (project.data?.total_top_clips && project.data.total_top_clips > 0) ||
      (status.data?.candidate_count && status.data.candidate_count > 0)
    )
  );

  const candidates = useQuery({
    queryKey: ["project-clips", projectId],
    queryFn: () => api<ProjectClip[]>(`/api/projects/${projectId}/clips`),
    enabled: !isFailed && Boolean(projectId),
    refetchInterval: (query) => {
      if (!isCompletedOrReady && !query.state.data?.length) {
        return 5000;
      }
      return query.state.data?.some((clip) =>
        ["queued", "running"].includes(clip.preview_status || "") ||
        ["queued", "running"].includes(clip.final_status || ""),
      )
        ? 2000
        : false;
    },
  });

  const hasClips = Boolean(candidates.data && candidates.data.length > 0);
  const isProcessing = !isFailed && !isCompletedOrReady && !hasClips;

  useEffect(() => {
    if (!isProcessing) return;
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isProcessing]);

  useEffect(() => {
    const currentProgress = status.data?.progress ?? 0;
    const currentStep = status.data?.current_step ?? "";
    if (currentProgress !== lastProgressValue || currentStep !== lastStepValue) {
      setLastProgressValue(currentProgress);
      setLastStepValue(currentStep);
      setLastProgressChangeSeconds(elapsedSeconds);
      setRecoveryMessage("");
    }
  }, [status.data?.progress, status.data?.current_step, elapsedSeconds, lastProgressValue, lastStepValue]);

  useEffect(() => {
    if (!selectedCandidateId && candidates.data?.length) {
      setSelectedCandidateId(candidates.data[0].id);
    }
  }, [candidates.data, selectedCandidateId]);

  const handleCheckStatus = async () => {
    setRecoveryMessage("Memeriksa ulang status proyek...");
    try {
      const [newStatus, newProject, newClips] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: ["status", projectId],
          queryFn: () => api<Status>(`/api/projects/${projectId}/status`),
        }),
        queryClient.fetchQuery({
          queryKey: ["project", projectId],
          queryFn: () => api<Project>(`/api/projects/${projectId}`),
        }),
        queryClient.fetchQuery({
          queryKey: ["project-clips", projectId],
          queryFn: () => api<ProjectClip[]>(`/api/projects/${projectId}/clips`),
        }),
      ]);
      if (newClips && newClips.length > 0) {
        setRecoveryMessage("Kandidat berhasil dimuat!");
      } else if (newStatus.status === "transformation_draft" || newStatus.status === "candidates_ready") {
        setRecoveryMessage("Proyek selesai diproses. Memuat klip...");
      } else {
        setRecoveryMessage(`Worker masih aktif: ${newStatus.current_step || newStatus.status} (${newStatus.progress}%)`);
      }
    } catch (err) {
      setRecoveryMessage(err instanceof Error ? err.message : "Gagal memeriksa status.");
    }
  };

  const handleForceLoadClips = async () => {
    setManualLoadingClips(true);
    setRecoveryMessage("Memuat kandidat dari database...");
    try {
      const clips = await api<ProjectClip[]>(`/api/projects/${projectId}/clips`);
      if (clips && clips.length > 0) {
        queryClient.setQueryData(["project-clips", projectId], clips);
        setRecoveryMessage(`${clips.length} kandidat klip ditemukan!`);
      } else {
        setRecoveryMessage("Kandidat belum tersedia di database. Worker masih bekerja.");
      }
    } catch (err) {
      setRecoveryMessage(err instanceof Error ? err.message : "Gagal memuat kandidat.");
    } finally {
      setManualLoadingClips(false);
    }
  };

  const openEditor = useMutation({
    mutationFn: async (clip: ProjectClip) => {
      console.log("Edit clip clicked", {
        clip,
        candidate_id: clip.candidate_id || clip.id,
        transformation_id: clip.transformation_id,
      });
      if (clip.transformation_id) {
        return { transformation_id: clip.transformation_id, message: "Editor dibuka." };
      }
      const endpoint = `/api/candidates/${clip.candidate_id || clip.id}/select`;
      console.log("Opening editor via", endpoint);
      return api<CandidateSelection>(endpoint, { method: "POST" });
    },
    onMutate: (clip) => {
      setActionKey(`edit:${clip.id}`);
      setActionMessage("");
    },
    onSuccess: (result) => {
      console.log("Edit clip response", result);
      if (!result.transformation_id) {
        setActionMessage("Gagal membuka editor klip. ID transformation tidak ditemukan.");
        return;
      }
      navigate(`/transformations/${result.transformation_id}`);
    },
    onError: (error) => {
      console.error("Edit clip failed", error);
      setActionMessage(
        error instanceof Error
          ? error.message
          : "Gagal membuka editor klip. ID transformation tidak ditemukan.",
      );
    },
    onSettled: () => setActionKey(""),
  });
  const queueRender = useMutation({
    mutationFn: async ({ clip, preview }: { clip: ProjectClip; preview: boolean }) => {
      console.log(preview ? "Render preview clicked" : "Render final clicked", {
        clip,
        candidate_id: clip.candidate_id || clip.id,
        transformation_id: clip.transformation_id,
      });
      let transformationId = clip.transformation_id;
      if (!transformationId) {
        const selection = await api<CandidateSelection>(
          `/api/candidates/${clip.candidate_id || clip.id}/select`,
          { method: "POST" },
        );
        transformationId = selection.transformation_id;
      }
      if (!transformationId) {
        throw new Error("Gagal render. ID transformation tidak ditemukan.");
      }
      const endpoint = `/api/transformations/${transformationId}/${
          preview ? "render-preview" : "render-final"
        }`;
      console.log("Calling render endpoint", endpoint);
      return api(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preset: "blurred_background",
            subtitle_language: "id",
          }),
        },
      );
    },
    onMutate: ({ clip, preview }) => {
      setActionKey(`${preview ? "preview" : "final"}:${clip.id}`);
      setActionMessage("");
    },
    onSuccess: async (_result, variables) => {
      setActionMessage(
        variables.preview ? "Render preview dimulai." : "Render final dimulai.",
      );
      await queryClient.invalidateQueries({ queryKey: ["project-clips", projectId] });
    },
    onError: (error) => {
      console.error("Render action failed", error);
      setActionMessage(
        error instanceof Error
          ? error.message
          : "Terjadi kesalahan saat memproses permintaan.",
      );
    },
    onSettled: () => setActionKey(""),
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
      queryClient.setQueryData<ProjectClip[]>(
        ["project-clips", projectId],
        (current) =>
          current?.map((candidate) =>
            candidate.id === updated.id ? { ...candidate, ...updated } : candidate,
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

  if (status.data?.status === "failed" || project.data?.status === "failed") {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="text-5xl">!</div>
        <h1 className="mt-4 text-2xl font-black text-red-700">Pemrosesan gagal</h1>
        <p className="mt-3 text-slate-600">
          {status.data?.error_message || "Terjadi kesalahan saat memproses video."}
        </p>
        {status.data?.job_id && (
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

  if (isProcessing) {
    const progress = status.data?.progress || 0;
    const effectiveElapsed = status.data?.elapsed_seconds ?? elapsedSeconds;
    const currentStep = status.data?.current_step || "Menyiapkan klip...";
    const secondsSinceChange = Math.max(0, elapsedSeconds - lastProgressChangeSeconds);

    let adaptiveCandidateMessage = "";
    if (progress >= 70 || status.data?.status === "generating_candidates") {
      if (secondsSinceChange > 300 || effectiveElapsed > 300) {
        adaptiveCandidateMessage = "Tahap ini lama karena video panjang. Anda bisa meninggalkan halaman ini atau mengecek status di bawah.";
      } else if (secondsSinceChange > 180 || effectiveElapsed > 180) {
        adaptiveCandidateMessage = "Masih bekerja. Proses kandidat dan thumbnail sedang berjalan di worker.";
      } else if (secondsSinceChange > 60 || effectiveElapsed > 60) {
        adaptiveCandidateMessage = "Masih membuat kandidat klip. Video panjang bisa membutuhkan beberapa menit.";
      }
    }

    const isStale2Min = secondsSinceChange >= 120;
    const isStale5Min = secondsSinceChange >= 300 || Boolean(status.data?.is_stale);

    return (
      <div className="space-y-8">
        <WorkflowSteps current={2} />
        <div className="mx-auto grid max-w-6xl gap-8 pt-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="flex min-h-[610px] flex-col justify-center">
            {/* Progress Card */}
            <div className="max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-violet-600 font-bold text-white shadow-md shadow-violet-200">
                  <span className="text-xl">✨</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-black text-slate-900">{project.data?.title}</p>
                    <span className="shrink-0 rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-bold text-violet-700">
                      {progress}%
                    </span>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all duration-500"
                      style={{ width: `${Math.max(5, progress)}%` }}
                    />
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">{currentStep}</span>
                    <span className="flex items-center gap-1 font-mono">
                      ⏱️ {formatTime(effectiveElapsed)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Adaptive duration message */}
            {adaptiveCandidateMessage && (
              <div className="mt-4 max-w-2xl rounded-xl border border-cyan-200 bg-cyan-50/80 p-3.5 text-xs text-cyan-900 shadow-sm transition-all">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-base">⏳</span>
                  <div>
                    <p className="font-bold">Info Pemrosesan Video</p>
                    <p className="mt-0.5 text-cyan-800">{adaptiveCandidateMessage}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Stale info banner (2+ minutes without progress change) */}
            {isStale2Min && !adaptiveCandidateMessage && (
              <div className="mt-4 max-w-2xl rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900 shadow-sm">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-base">ℹ️</span>
                  <div>
                    <p className="font-bold">Proses Berlangsung Normal</p>
                    <p className="mt-0.5 text-amber-800">
                      Proses masih berjalan di latar belakang. Video panjang memerlukan waktu ekstra untuk ekstraksi audio, analisis AI, dan pembuatan klip.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Recovery action card (5+ minutes or backend stale flag) */}
            {isStale5Min && (
              <div className="mt-4 max-w-2xl rounded-2xl border border-indigo-200 bg-indigo-50/90 p-4 text-xs text-indigo-950 shadow-md">
                <p className="font-black text-sm text-indigo-900">
                  🔍 Cek Status / Pemulihan Klip
                </p>
                <p className="mt-1 text-indigo-800 leading-relaxed">
                  Jika proses terlihat membutuhkan waktu lebih lama dari perkiraan, Anda dapat memeriksa status terbaru atau langsung memuat kandidat jika worker telah menyelesaikannya.
                </p>
                <div className="mt-3 flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    className="btn px-4 py-2 text-xs font-bold"
                    onClick={handleCheckStatus}
                  >
                    Cek Ulang Status
                  </button>
                  <button
                    type="button"
                    className="btn-secondary px-4 py-2 text-xs font-bold"
                    disabled={manualLoadingClips}
                    onClick={handleForceLoadClips}
                  >
                    {manualLoadingClips ? "Memeriksa klip..." : "Muat Kandidat jika Sudah Tersedia"}
                  </button>
                </div>
                {recoveryMessage && (
                  <p className="mt-2.5 font-bold text-indigo-700 bg-white/80 rounded-lg p-2 border border-indigo-100">
                    {recoveryMessage}
                  </p>
                )}
              </div>
            )}

            <h1 className="mt-8 text-3xl font-black text-slate-900">
              {project.data?.content_type === "sports"
                ? "Menganalisis pertandingan dan mencari momen seru"
                : "Menganalisis percakapan dan mencari klip"}
            </h1>
            <p className="mt-2 max-w-xl text-base text-slate-500">
              Anda dapat meninggalkan halaman ini. Proses tetap berjalan sampai
              kandidat klip siap.
            </p>

            {/* Sub-stages list */}
            <ol className="mt-6 space-y-3 max-w-2xl">
              {processingStages.map((stage) => {
                const isSports = project.data?.content_type === "sports";
                const label = isSports && stage.sportsLabel ? stage.sportsLabel : stage.label;
                const done = progress >= stage.at;
                const active =
                  !done &&
                  processingStages.find((item) => progress < item.at)?.key === stage.key;

                return (
                  <li
                    className={`flex items-center gap-3.5 text-sm transition ${
                      done
                        ? "text-slate-800"
                        : active
                          ? "font-bold text-violet-700"
                          : "text-slate-400"
                    }`}
                    key={stage.key}
                  >
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-black transition-all ${
                        done
                          ? "bg-emerald-500 text-white"
                          : active
                            ? "animate-pulse border-2 border-violet-600 bg-violet-100 text-violet-700"
                            : "border border-slate-300 bg-slate-100 text-transparent"
                      }`}
                    >
                      {done ? "✓" : active ? "●" : ""}
                    </span>
                    <span className="flex-1">
                      {active ? (
                        <span className="flex items-center justify-between gap-2">
                          <span>{currentStep || label}</span>
                          <span className="text-xs font-mono font-bold text-violet-600">{progress}%</span>
                        </span>
                      ) : (
                        label
                      )}
                    </span>
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
            <p className="mt-10 text-sm font-bold uppercase tracking-wider text-violet-600">Tutorial</p>
            <h2 className="mt-2 text-2xl font-black text-slate-900">
              Ubah video panjang menjadi short dalam sekali proses
            </h2>
            <div className="mt-6 flex aspect-video items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-50 text-5xl text-violet-400">
              🎬
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
    return (
      <div className="py-20 text-center space-y-4">
        <p className="text-slate-500 font-semibold">Memuat kandidat klip...</p>
        <button
          type="button"
          className="btn-secondary px-4 py-2 text-xs"
          onClick={handleCheckStatus}
        >
          Muat Ulang
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <WorkflowSteps current={2} />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="max-w-4xl text-2xl font-black">{project.data?.title}</h1>
          <p className="mt-1 text-slate-500">
            {candidates.data?.length || 0} klip terbaik tersimpan - edit dan render per klip
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
          {candidates.data?.length || 0}/5 klip terbaik
        </span>
        <button
          className="btn"
          disabled={Boolean(actionKey)}
          onClick={() => openEditor.mutate(selected)}
        >
          {actionKey === `edit:${selected.id}` ? "Membuka..." : "Edit klip"}
        </button>
        <span className="ml-auto text-sm text-slate-500">
          Anda bisa kembali ke daftar ini setelah mengedit setiap klip.
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
                  src={
                    candidate.short_source_clip_path
                      ? candidateVideoUrl(candidate.id)
                      : `${sourceVideoUrl(projectId)}#t=${candidate.start_seconds},${candidate.end_seconds}`
                  }
                />
                {candidate.file_missing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4 text-center text-sm font-bold text-white">
                    File short clip hilang. Proses ulang project.
                  </div>
                )}
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
                <div className="mt-6 grid gap-3 border-t border-slate-200 pt-5 sm:grid-cols-2 lg:grid-cols-4">
                  <button
                    type="button"
                    className="btn"
                    disabled={Boolean(actionKey) || candidate.file_missing}
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditor.mutate(candidate);
                    }}
                  >
                    {actionKey === `edit:${candidate.id}` ? "Membuka..." : "Edit"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={Boolean(actionKey) || candidate.file_missing}
                    onClick={(event) => {
                      event.stopPropagation();
                      queueRender.mutate({ clip: candidate, preview: true });
                    }}
                  >
                    {actionKey === `preview:${candidate.id}`
                      ? "Memulai..."
                      : candidate.preview_status === "completed"
                      ? "Render preview ulang"
                      : "Render preview"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={Boolean(actionKey) || candidate.file_missing}
                    onClick={(event) => {
                      event.stopPropagation();
                      queueRender.mutate({ clip: candidate, preview: false });
                    }}
                  >
                    {actionKey === `final:${candidate.id}`
                      ? "Memulai..."
                      : candidate.final_status === "completed"
                      ? "Render final ulang"
                      : "Render final"}
                  </button>
                  {candidate.final_render_id && candidate.final_status === "completed" ? (
                    <a
                      className="btn-secondary text-center"
                      href={downloadUrl(candidate.final_render_id)}
                      onClick={(event) => event.stopPropagation()}
                    >
                      Download
                    </a>
                  ) : (
                    <span className="rounded-xl bg-slate-100 px-3 py-2 text-center text-sm font-bold text-slate-500">
                      Final: {candidate.final_status || "belum ada"}
                    </span>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {actionMessage && (
        <p className="rounded-xl bg-slate-100 p-3 text-sm font-semibold text-slate-700">
          {actionMessage}
        </p>
      )}
      {openEditor.error && <p className="text-red-600">{openEditor.error.message}</p>}
      {queueRender.error && <p className="text-red-600">{queueRender.error.message}</p>}
      {regenerateCopy.error && (
        <p className="text-red-600">{regenerateCopy.error.message}</p>
      )}
    </div>
  );
}
