import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, downloadUrl, sourceVideoUrl } from "../api/client";
import { WorkflowSteps } from "../components/WorkflowSteps";
import type {
  OriginalityReport,
  Transformation,
  TransformationContext,
} from "../types";

type Render = {
  id: string;
  status: string;
  preset: string;
  subtitle_language: string;
  width: number;
  height: number;
  frame_rate: number;
  error_message?: string;
};

type SourceMetadata = {
  url: string;
  title: string | null;
  description: string | null;
  creator: string | null;
  site_name: string | null;
  thumbnail_url: string | null;
  is_direct_media: boolean;
};

type EditorTab = "script" | "caption" | "review" | "export";
type RenderPreset =
  | "blurred_background"
  | "center_crop"
  | "fit_background"
  | "picture_in_picture";

const presetOptions: Array<{ value: RenderPreset; label: string }> = [
  { value: "blurred_background", label: "Latar buram" },
  { value: "center_crop", label: "Potong tengah" },
  { value: "fit_background", label: "Video penuh" },
  { value: "picture_in_picture", label: "Picture in picture" },
];

const renderStatusLabels: Record<string, string> = {
  queued: "Menunggu antrean",
  running: "Sedang merender",
  completed: "Selesai",
  failed: "Gagal",
  superseded: "Perlu dibuat ulang",
};

function formatTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function PresetVideo({
  src,
  preset,
  controls = false,
  className = "",
}: {
  src: string;
  preset: RenderPreset;
  controls?: boolean;
  className?: string;
}) {
  if (preset === "center_crop") {
    return (
      <video
        className={`h-full w-full object-cover ${className}`}
        controls={controls}
        muted={!controls}
        preload="metadata"
        src={src}
      />
    );
  }
  if (preset === "fit_background") {
    return (
      <video
        className={`h-full w-full bg-black object-contain ${className}`}
        controls={controls}
        muted={!controls}
        preload="metadata"
        src={src}
      />
    );
  }
  return (
    <div className={`relative h-full w-full overflow-hidden bg-black ${className}`}>
      <video
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl opacity-75"
        muted
        preload="metadata"
        src={src}
      />
      <video
        className={
          preset === "picture_in_picture"
            ? "absolute bottom-4 left-1/2 h-[46%] w-[82%] -translate-x-1/2 rounded-lg border-2 border-white/80 bg-black object-contain shadow-xl"
            : "relative h-full w-full object-contain"
        }
        controls={controls}
        muted={!controls}
        preload="metadata"
        src={src}
      />
    </div>
  );
}

export function TransformationPage() {
  const { transformationId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Transformation>();
  const [report, setReport] = useState<OriginalityReport>();
  const [render, setRender] = useState<Render>();
  const [preset, setPreset] = useState<RenderPreset>("blurred_background");
  const [subtitleLanguage, setSubtitleLanguage] = useState<"id" | "en">("id");
  const [captionCopied, setCaptionCopied] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<EditorTab>("script");

  const plan = useQuery({
    queryKey: ["transformation", transformationId],
    queryFn: () => api<Transformation>(`/api/transformations/${transformationId}`),
  });
  const context = useQuery({
    queryKey: ["transformation-context", transformationId],
    queryFn: () =>
      api<TransformationContext>(`/api/transformations/${transformationId}/context`),
  });
  const existingReport = useQuery({
    queryKey: ["originality", transformationId],
    queryFn: () =>
      api<OriginalityReport>(
        `/api/transformations/${transformationId}/originality-report`,
      ),
    retry: false,
  });
  const latestRender = useQuery({
    queryKey: ["latest-render", transformationId],
    queryFn: () =>
      api<Render>(`/api/transformations/${transformationId}/latest-render`),
    retry: false,
  });

  useEffect(() => {
    if (plan.data) setDraft(plan.data);
  }, [plan.data]);
  useEffect(() => {
    if (existingReport.data) setReport(existingReport.data);
  }, [existingReport.data]);
  useEffect(() => {
    if (context.data) {
      setUploadTitle(context.data.candidate_title);
      setSourceUrl(context.data.source_url || "");
    }
  }, [context.data]);

  async function persistDraft() {
    if (!draft) throw new Error("Data transformasi belum tersedia.");
    const cleanTitle = uploadTitle.trim();
    if (cleanTitle.length < 5) {
      throw new Error("Judul video minimal 5 karakter.");
    }
    const savedCandidate = await api<{ suggested_title: string }>(
      `/api/candidates/${draft.candidate_id}/title`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggested_title: cleanTitle }),
      },
    );
    setUploadTitle(savedCandidate.suggested_title);
    client.setQueryData<TransformationContext>(
      ["transformation-context", transformationId],
      (current) =>
        current
          ? { ...current, candidate_title: savedCandidate.suggested_title }
          : current,
    );
    const saved = await api<Transformation>(
      `/api/transformations/${transformationId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      },
    );
    setDraft(saved);
    client.setQueryData(["transformation", transformationId], saved);
    return saved;
  }

  const save = useMutation({
    mutationFn: persistDraft,
    onSuccess: () => setMessage("Perubahan berhasil disimpan."),
  });
  const regenerate = useMutation({
    mutationFn: () =>
      api<Transformation>(
        `/api/transformations/${transformationId}/regenerate`,
        { method: "POST" },
      ),
    onSuccess: (data) => {
      setDraft(data);
      setReport(undefined);
      setRender(undefined);
      setMessage("Naskah AI berhasil dibuat ulang.");
      client.setQueryData(["transformation", transformationId], data);
    },
  });
  const regenerateCaption = useMutation({
    mutationFn: async () => {
      await persistDraft();
      return api<Transformation>(
        `/api/transformations/${transformationId}/caption`,
        { method: "POST" },
      );
    },
    onSuccess: (data) => {
      setDraft(data);
      setCaptionCopied(false);
      setMessage("Deskripsi berhasil dibuat ulang.");
    },
  });
  const applySource = useMutation({
    mutationFn: async () => {
      const cleanUrl = sourceUrl.trim();
      if (!cleanUrl) throw new Error("Tempel link sumber terlebih dahulu.");
      await persistDraft();
      const metadata = await api<SourceMetadata>(
        `/api/transformations/${transformationId}/source-metadata`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: cleanUrl }),
        },
      );
      const updated = await api<Transformation>(
        `/api/transformations/${transformationId}/caption`,
        { method: "POST" },
      );
      return { metadata, updated };
    },
    onSuccess: ({ metadata, updated }) => {
      const creator = metadata.creator || metadata.site_name;
      setSourceUrl(metadata.url);
      setDraft(updated);
      setCaptionCopied(false);
      client.setQueryData<TransformationContext>(
        ["transformation-context", transformationId],
        (current) =>
          current
            ? {
                ...current,
                source_url: metadata.url,
                source_title: metadata.title || current.source_title,
                source_creator: creator || current.source_creator,
              }
            : current,
      );
      setMessage(
        creator
          ? `Data sumber dari ${creator} berhasil diterapkan.`
          : "Data sumber berhasil diterapkan.",
      );
    },
  });
  const assess = useMutation({
    mutationFn: async () => {
      await persistDraft();
      return api<OriginalityReport>(
        `/api/transformations/${transformationId}/assess`,
        { method: "POST" },
      );
    },
    onSuccess: (data) => {
      setReport(data);
      setMessage("Penilaian selesai.");
    },
  });
  const queueRender = useMutation({
    mutationFn: async (preview: boolean) => {
      await persistDraft();
      return api<Render>(
        `/api/transformations/${transformationId}/${preview ? "preview" : "render"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preset,
            subtitle_language: subtitleLanguage,
          }),
        },
      );
    },
    onSuccess: (data) => {
      setRender(data);
      setMessage("Render masuk antrean.");
    },
  });
  const reprocess = useMutation({
    mutationFn: () =>
      api(`/api/projects/${draft?.project_id}/reprocess`, { method: "POST" }),
    onSuccess: () => navigate(`/projects/${draft?.project_id}`),
  });
  const renderStatus = useQuery({
    queryKey: ["render", render?.id],
    queryFn: () => api<Render>(`/api/renders/${render?.id}`),
    enabled: Boolean(render?.id),
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.status || "")
        ? 2000
        : false,
  });

  if (!draft || !context.data) {
    return <p className="py-20 text-center text-slate-500">Memuat editor...</p>;
  }

  const activeRender = renderStatus.data || render || latestRender.data;
  const red = report?.overall_status === "transformation_required";
  const transcriptionReady = !context.data.transcription_is_demo;
  const set = (key: keyof Transformation, value: unknown) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const error =
    save.error ||
    regenerate.error ||
    regenerateCaption.error ||
    applySource.error ||
    assess.error ||
    queueRender.error;

  async function copyCaption() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.social_caption);
    setCaptionCopied(true);
  }

  const tabs: Array<{ id: EditorTab; label: string }> = [
    { id: "script", label: "Naskah" },
    { id: "caption", label: "Deskripsi" },
    { id: "review", label: "Penilaian" },
    { id: "export", label: "Export" },
  ];
  const sourceClipUrl = `${sourceVideoUrl(draft.project_id)}#t=${
    context.data.clip_start_seconds
  },${context.data.clip_end_seconds}`;
  const renderedPreviewAvailable =
    activeRender?.status === "completed" && activeRender.preset === preset;
  const subtitlePreview =
    context.data.candidate_transcript
      .split("\n")
      .find((line) => line.trim())
      ?.replace(/^\[\d{2}:\d{2}\]\s*/, "") ||
    "Subtitle ucapan akan tampil di sini";

  return (
    <div className="space-y-6">
      <WorkflowSteps current={3} />

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-violet-600">Tahap 3 - Editing Klip</p>
          <h1 className="mt-1 text-2xl font-black">{context.data.project_title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatTime(context.data.clip_start_seconds)} -{" "}
            {formatTime(context.data.clip_end_seconds)}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            className="btn-secondary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Menyimpan..." : "Simpan"}
          </button>
          <button
            className="btn"
            disabled={!report || red || !transcriptionReady || queueRender.isPending}
            onClick={() => {
              setActiveTab("export");
              queueRender.mutate(false);
            }}
          >
            Render final
          </button>
        </div>
      </header>

      <div className="grid min-h-[650px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg xl:grid-cols-[minmax(500px,1.08fr)_minmax(420px,0.92fr)]">
        <section className="border-b border-slate-200 xl:border-b-0 xl:border-r">
          <nav className="flex overflow-x-auto border-b border-slate-200 px-4">
            {tabs.map((tab) => (
              <button
                className={`border-b-2 px-5 py-4 text-sm font-bold transition ${
                  activeTab === tab.id
                    ? "border-violet-600 text-violet-700"
                    : "border-transparent text-slate-400 hover:text-slate-700"
                }`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="max-h-[610px] overflow-y-auto p-4 sm:p-5">
            {activeTab === "script" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-black">Naskah dan hook</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Edit teks seperti dokumen sebelum membuat video.
                    </p>
                  </div>
                  <button
                    className="btn-secondary shrink-0"
                    disabled={regenerate.isPending}
                    onClick={() => regenerate.mutate()}
                  >
                    {regenerate.isPending ? "Membuat..." : "Buat ulang AI"}
                  </button>
                </div>
                <div>
                  <label htmlFor="upload_title">Judul video saat upload</label>
                  <input
                    id="upload_title"
                    maxLength={300}
                    value={uploadTitle}
                    onChange={(event) => setUploadTitle(event.target.value)}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Dibuat dari momen dan transkrip klip. Anda tetap dapat
                    menyuntingnya sebelum publikasi.
                  </p>
                </div>
                <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-violet-600">
                        Transkrip klip asli
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{uploadTitle}</p>
                    </div>
                    <span className="rounded-lg bg-white px-2 py-1 text-xs font-bold text-slate-500">
                      {formatTime(context.data.clip_start_seconds)}-
                      {formatTime(context.data.clip_end_seconds)}
                    </span>
                  </div>
                  <div className="mt-3 max-h-36 overflow-y-auto whitespace-pre-line text-sm leading-6 text-slate-700">
                    {context.data.candidate_transcript ||
                      "Transkrip suara belum tersedia untuk klip ini."}
                  </div>
                </div>
                <div>
                  <label>Audiens</label>
                  <input
                    value={draft.audience}
                    onChange={(event) => set("audience", event.target.value)}
                  />
                </div>
                <div>
                  <label>Hook pembuka</label>
                  <textarea
                    rows={2}
                    value={draft.original_hook}
                    onChange={(event) => set("original_hook", event.target.value)}
                  />
                </div>
                <div>
                  <label>Naskah komentar</label>
                  <textarea
                    rows={7}
                    value={draft.commentary_script}
                    onChange={(event) => set("commentary_script", event.target.value)}
                  />
                </div>
                <div>
                  <label>Kesimpulan</label>
                  <textarea
                    rows={2}
                    value={draft.conclusion}
                    onChange={(event) => set("conclusion", event.target.value)}
                  />
                </div>
              </div>
            )}

            {activeTab === "caption" && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-black">Deskripsi video</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Deskripsi publikasi, konteks, link, dan channel sumber.
                  </p>
                </div>
                {context.data.content_type === "sports" && (
                  <div className="rounded-xl bg-violet-50 p-4 text-sm text-violet-800">
                    Deskripsi olahraga dibuat dari timestamp, judul video, dan
                    ucapan komentator pada klip terpilih.
                  </div>
                )}
                <textarea
                  rows={13}
                  value={draft.social_caption}
                  onChange={(event) => {
                    set("social_caption", event.target.value);
                    setCaptionCopied(false);
                  }}
                />
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <label htmlFor="editor_source_url">Link sumber video</label>
                  <p className="mb-3 mt-1 text-xs text-slate-500">
                    Tempel link jika belum dicantumkan saat upload. Judul,
                    channel, dan keterangan sumber akan diambil otomatis.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id="editor_source_url"
                      type="url"
                      placeholder="https://youtube.com/watch?v=..."
                      value={sourceUrl}
                      onChange={(event) => setSourceUrl(event.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-secondary shrink-0"
                      disabled={applySource.isPending || !sourceUrl.trim()}
                      onClick={() => applySource.mutate()}
                    >
                      {applySource.isPending
                        ? "Mengambil data..."
                        : "Ambil data sumber"}
                    </button>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    className="btn-secondary"
                    disabled={regenerateCaption.isPending || applySource.isPending}
                    onClick={() => regenerateCaption.mutate()}
                  >
                    {regenerateCaption.isPending
                      ? "Membuat..."
                      : "Buat ulang deskripsi"}
                  </button>
                  <button
                    className="btn"
                    disabled={!draft.social_caption}
                    onClick={copyCaption}
                  >
                    {captionCopied ? "Tersalin" : "Salin deskripsi"}
                  </button>
                </div>
              </div>
            )}

            {activeTab === "review" && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-black">Penilaian orisinalitas</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Jalankan pemeriksaan sebelum render final.
                  </p>
                </div>
                <button
                  className="btn w-full py-3"
                  disabled={assess.isPending}
                  onClick={() => assess.mutate()}
                >
                  {assess.isPending ? "Menilai..." : "Jalankan penilaian"}
                </button>
                {report && (
                  <>
                    <div
                      className={`rounded-2xl p-5 ${
                        red
                          ? "bg-red-50 text-red-700"
                          : report.overall_status === "revision_recommended"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      <strong className="text-lg">
                        {report.overall_status === "ready_for_manual_review"
                          ? "Siap untuk ditinjau"
                          : report.overall_status === "revision_recommended"
                            ? "Perbaikan disarankan"
                            : "Transformasi perlu diperbaiki"}
                      </strong>
                      <p className="mt-1 text-sm">
                        Risiko hak cipta: {report.copyright_risk_level}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        ["Transformasi", report.transformative_value_score],
                        ["Kontribusi", report.creator_contribution_score],
                        ["Informasi baru", report.new_information_score],
                        ["Risiko repetisi", report.repetition_risk_score],
                      ].map(([label, value]) => (
                        <div className="rounded-xl bg-slate-50 p-4" key={String(label)}>
                          <p className="text-xs text-slate-500">{label}</p>
                          <strong className="text-2xl">{Number(value).toFixed(0)}</strong>
                        </div>
                      ))}
                    </div>
                    {report.recommendations_json.map((item) => (
                      <p className="rounded-xl bg-violet-50 p-3 text-sm text-violet-700" key={item}>
                        {item}
                      </p>
                    ))}
                  </>
                )}
              </div>
            )}

            {activeTab === "export" && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-black">Tampilan dan export</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Pilih gaya video vertikal dan bahasa subtitle.
                  </p>
                </div>
                <div>
                  <label htmlFor="subtitle_language">Bahasa subtitle</label>
                  <select
                    id="subtitle_language"
                    value={subtitleLanguage}
                    onChange={(event) =>
                      setSubtitleLanguage(event.target.value as "id" | "en")
                    }
                  >
                    <option value="id">Bahasa Indonesia</option>
                    <option value="en">English</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="render_preset">Template video</label>
                  <div className="grid grid-cols-2 gap-3">
                    {presetOptions.map(({ value, label }) => (
                      <button
                        className={`rounded-2xl border-2 p-2 text-sm font-bold ${
                          preset === value
                            ? "border-violet-600 bg-violet-50 text-violet-700"
                            : "border-slate-200 bg-slate-50 text-slate-600"
                        }`}
                        key={value}
                        onClick={() => setPreset(value)}
                      >
                        <div className="mx-auto mb-2 aspect-[9/16] w-20 overflow-hidden rounded-lg bg-black shadow-sm">
                          <PresetVideo src={sourceClipUrl} preset={value} />
                        </div>
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {!transcriptionReady && (
                  <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
                    Subtitle audio asli belum aktif.
                    {context.data.configured_transcription_provider !== "mock" && (
                      <button
                        className="mt-3 block font-bold underline"
                        onClick={() => reprocess.mutate()}
                      >
                        Proses ulang speech-to-text
                      </button>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    className="btn-secondary"
                    disabled={queueRender.isPending || !transcriptionReady}
                    onClick={() => queueRender.mutate(true)}
                  >
                    Render preview
                  </button>
                  <button
                    className="btn"
                    disabled={!report || red || queueRender.isPending || !transcriptionReady}
                    onClick={() => queueRender.mutate(false)}
                  >
                    Render final
                  </button>
                </div>
                {activeRender && (
                  <p className="rounded-xl bg-slate-50 p-3 text-sm">
                    Status:{" "}
                    <strong>
                      {renderStatusLabels[activeRender.status] || activeRender.status}
                    </strong>
                  </p>
                )}
                {activeRender?.status === "completed" && (
                  <a className="btn w-full" href={downloadUrl(activeRender.id)}>
                    Download MP4
                  </a>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-[650px] flex-col bg-slate-100">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
            <span className="text-sm font-bold">Preview klip</span>
            <span className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
              9:16
            </span>
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="relative aspect-[9/16] max-h-[540px] overflow-hidden rounded-2xl bg-black shadow-2xl">
              {renderedPreviewAvailable ? (
                <video
                  className="h-full w-full object-cover"
                  controls
                  preload="metadata"
                  src={downloadUrl(activeRender.id)}
                />
              ) : (
                <PresetVideo src={sourceClipUrl} preset={preset} controls />
              )}
              {!renderedPreviewAvailable && (
                <>
                  <div className="pointer-events-none absolute left-5 right-5 top-7 rounded-xl bg-black/60 p-3 text-center text-lg font-black text-white">
                    {draft.original_hook || "Hook video Anda"}
                  </div>
                  <div className="pointer-events-none absolute bottom-14 left-5 right-5 rounded-xl bg-white/90 p-3 text-center font-black text-slate-900">
                    {subtitlePreview}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="border-t border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">
                {formatTime(context.data.clip_start_seconds)}
              </span>
              <div className="relative h-12 flex-1 overflow-hidden rounded-lg bg-violet-100">
                <div className="absolute inset-y-0 left-1/3 w-0.5 bg-violet-700" />
                <div className="flex h-full items-center justify-around text-xs font-black tracking-widest text-violet-300">
                  <span>||||||||</span>
                  <span>||||||||</span>
                  <span>||||||||</span>
                </div>
              </div>
              <span className="text-xs text-slate-500">
                {formatTime(context.data.clip_end_seconds)}
              </span>
            </div>
          </div>
        </section>
      </div>

      {context.data.source_mismatch_warning && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          {context.data.source_mismatch_warning}
        </p>
      )}
      {message && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">
          {message}
        </div>
      )}
      {error && <p className="text-red-600">{error.message}</p>}
    </div>
  );
}
