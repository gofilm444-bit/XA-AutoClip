import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { api, upload } from "../api/client";
import { useBlankManualEditor } from "../hooks/useBlankManualEditor";
import { WorkflowSteps } from "../components/WorkflowSteps";
import type { Project } from "../types";

type SourceMetadata = {
  url: string;
  title: string | null;
  description: string | null;
  creator: string | null;
  site_name: string | null;
  thumbnail_url: string | null;
  is_direct_media: boolean;
};

type ManualEditorResult = {
  project_id: string;
  candidate_id: string;
  transformation_id: string;
  editor_url: string;
  status: string;
  duration: number;
};

const schema = z
  .object({
    source_url: z
      .string()
      .trim()
      .refine(
        (value) => !value || z.string().url().safeParse(value).success,
        "Masukkan link sumber yang valid.",
      ),
    source_channel: z.string().trim().max(200),
    source_title: z.string().trim().max(300),
    source_description: z.string().trim().max(10_000),
    file: z
      .custom<File | undefined>(
        (value) => value === undefined || value instanceof File,
        "Pilih file video yang valid.",
      )
      .optional(),
  })
  .superRefine((values, context) => {
    if (!values.source_url && !values.file) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["file"],
        message: "Masukkan link video atau pilih satu file video.",
      });
    }
  });

type FormData = z.infer<typeof schema>;

function fileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function NewProjectPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const autoClipEntry = searchParams.get("mode") === "autoclip";
  const manualEditor = useBlankManualEditor();
  const startedBlankRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);
  const [submissionStage, setSubmissionStage] = useState("");
  const [serverError, setServerError] = useState("");
  const [metadata, setMetadata] = useState<SourceMetadata>();
  const [readingLink, setReadingLink] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [language, setLanguage] = useState("auto");
  const [contentType, setContentType] = useState<"podcast" | "sports">("podcast");
  const [getAiClips, setGetAiClips] = useState(autoClipEntry);
  const manualEditorMode = !getAiClips;

  useEffect(() => {
    if (manualEditorMode && !startedBlankRef.current) {
      startedBlankRef.current = true;
      manualEditor.mutate();
    }
  }, [manualEditorMode, manualEditor]);
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      source_url: "",
      source_channel: "",
      source_title: "",
      source_description: "",
    },
  });
  const selectedFile = form.watch("file");
  const sourceUrl = form.watch("source_url");
  const linkReady = Boolean(metadata && sourceUrl);
  const inputReady = Boolean(selectedFile || linkReady);

  function selectFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setServerError("File harus berupa video MP4, MOV, atau WebM.");
      return;
    }
    setServerError("");
    form.setValue("file", file, { shouldValidate: true });
  }

  async function inspectLink() {
    const valid = await form.trigger("source_url");
    if (!valid) return;
    setReadingLink(true);
    setServerError("");
    try {
      const result = await api<SourceMetadata>("/api/source-metadata/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl }),
      });
      setMetadata(result);
      form.setValue("source_url", result.url, { shouldValidate: true });
      form.setValue("source_channel", result.creator || result.site_name || "");
      form.setValue("source_title", result.title || "");
      form.setValue("source_description", result.description || "");
      setServerError("");
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Link tidak dapat dibaca.");
    } finally {
      setReadingLink(false);
    }
  }

  async function submit(values: FormData) {
    setServerError("");
    setSubmissionStage("Menyiapkan proyek...");
    try {
      let source = values.source_url ? metadata : undefined;
      if (values.source_url && (!source || source.url !== values.source_url)) {
        setSubmissionStage("Membaca metadata sumber...");
        source = await api<SourceMetadata>("/api/source-metadata/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: values.source_url }),
        });
      }
      const fallbackName = values.file
        ? values.file.name.replace(/\.[^.]+$/, "")
        : source?.title || "Video dari link";
      const sourceName =
        values.source_channel || source?.creator || source?.site_name || null;
      const sourceTitle = values.source_title || source?.title || fallbackName;
      const sourceDescription =
        values.source_description || source?.description || null;
      setSubmissionStage("Membuat proyek...");
      const project = await api<Project>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: sourceTitle.slice(0, 200),
          description: (
            sourceDescription ||
            (values.source_url ? `Sumber: ${values.source_url}` : "Video unggahan pengguna")
          ).slice(0, 2000),
          content_type: contentType,
          source_declaration: {
            ownership_type: values.source_url ? "third_party_commentary" : "unknown",
            source_creator: sourceName,
            source_title: sourceTitle,
            source_description: sourceDescription,
            source_url: values.source_url || null,
            license_type: null,
            intended_use: getAiClips
              ? "Analisis dan komentar substantif dengan kontribusi kreator."
              : "Penyuntingan manual video oleh pengguna.",
            transformation_purpose: getAiClips ? "analysis" : "other",
            user_acknowledged: true,
          },
        }),
      });
      if (values.file) {
        setSubmissionStage("Mengunggah video...");
        await upload(`/api/projects/${project.id}/source`, values.file, setProgress);
      } else {
        setSubmissionStage("Mengambil video dari link...");
        await api(`/api/projects/${project.id}/source-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: values.source_url }),
        });
        setProgress(100);
      }
      if (getAiClips) {
        setSubmissionStage("Memulai analisis AI...");
        await api(`/api/projects/${project.id}/process`, { method: "POST" });
        navigate(`/projects/${project.id}`);
      } else {
        setSubmissionStage("Menyiapkan editor manual...");
        const manualEditor = await api<ManualEditorResult>(
          `/api/projects/${project.id}/manual-editor`,
          { method: "POST" },
        );
        navigate(manualEditor.editor_url);
      }
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Proyek gagal dibuat.");
      setSubmissionStage("");
    }
  }

  const fileError = form.formState.errors.file?.message?.toString();
  const urlError = form.formState.errors.source_url?.message?.toString();

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <WorkflowSteps current={1} />

      <form
        className="mx-auto max-w-3xl"
        onSubmit={form.handleSubmit(submit, (errors) => {
          setSubmissionStage("");
          setServerError(
            errors.source_url?.message?.toString() ||
              errors.file?.message?.toString() ||
              "Periksa kembali data video sebelum melanjutkan.",
          );
        })}
      >
        <fieldset className="mb-6 grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">Pilih mode proyek</legend>
          <button
            type="button"
            className={`border-l-4 px-4 py-3 text-left transition ${
              manualEditorMode
                ? "border-emerald-500 bg-emerald-50 text-slate-950"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
            onClick={() => setGetAiClips(false)}
          >
            <strong className="block">Edit Video Sendiri</strong>
            <span className="mt-1 block text-xs">Tanpa AI - langsung editor</span>
          </button>
          <button
            type="button"
            className={`border-l-4 px-4 py-3 text-left transition ${
              getAiClips
                ? "border-violet-500 bg-violet-50 text-slate-950"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
            onClick={() => setGetAiClips(true)}
          >
            <strong className="block">AutoClip Video Panjang</strong>
            <span className="mt-1 block text-xs">AI mencari kandidat klip terbaik</span>
          </button>
        </fieldset>
        {!inputReady ? (
          <div className="space-y-5 pt-8">
            <div className="text-center">
              <p className="text-sm font-bold text-violet-600">
                {manualEditorMode ? "Tanpa AI - langsung editor" : "AutoClip dengan AI"}
              </p>
              <h1 className="mt-2 text-3xl font-black">
                {manualEditorMode ? "Edit Video Sendiri" : "Masukkan video panjang"}
              </h1>
              <p className="mt-2 text-slate-500">
                {manualEditorMode
                  ? "Upload atau tempel link video untuk langsung masuk editor tanpa AI."
                  : "Tempel link atau upload video. AI akan mencari kandidat klip terbaik."}
              </p>
            </div>

            <div className="flex rounded-2xl bg-slate-100 p-1.5">
              <span className="flex items-center px-4 text-sm font-bold text-slate-500">
                LINK
              </span>
              <input
                className="border-0 bg-transparent focus:ring-0"
                placeholder="Paste link video sumber"
                {...form.register("source_url")}
              />
              <button
                type="button"
                className="btn shrink-0 bg-violet-100 text-violet-700 hover:bg-violet-200"
                disabled={readingLink}
                onClick={inspectLink}
              >
                {readingLink ? "Membaca..." : "Lanjut"}
              </button>
            </div>
            {urlError && <p className="text-sm text-red-600">{urlError}</p>}

            <button
              type="button"
              className={`flex min-h-[340px] w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-white transition ${
                dragging
                  ? "border-violet-500 bg-violet-50"
                  : "border-slate-300 hover:border-violet-400"
              }`}
              onClick={() => fileInput.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                selectFile(event.dataTransfer.files[0]);
              }}
            >
              <span className="rounded-2xl bg-violet-100 px-6 py-4 text-xl font-black text-violet-600">
                VIDEO
              </span>
              <span className="mt-5 text-lg font-bold text-violet-700">
                Klik untuk memilih atau drag & drop
              </span>
              <span className="mt-2 text-slate-500">
                Mendukung MP4, MOV, dan WebM
              </span>
            </button>
            <input
              ref={fileInput}
              className="hidden"
              type="file"
              accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
            {fileError && <p className="text-sm text-red-600">{fileError}</p>}
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4 pt-10">
            {getAiClips && <div>
              <p className="mb-3 text-sm font-bold text-slate-600">Jenis video</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className={`rounded-2xl border-2 p-4 text-left transition ${
                    contentType === "podcast"
                      ? "border-violet-500 bg-violet-50"
                      : "border-slate-200 bg-white"
                  }`}
                  onClick={() => setContentType("podcast")}
                >
                  <strong className="block">Podcast / Wawancara</strong>
                  <span className="mt-1 block text-sm text-slate-500">
                    Mencari gagasan, hook, dan percakapan terbaik.
                  </span>
                </button>
                <button
                  type="button"
                  className={`rounded-2xl border-2 p-4 text-left transition ${
                    contentType === "sports"
                      ? "border-violet-500 bg-violet-50"
                      : "border-slate-200 bg-white"
                  }`}
                  onClick={() => setContentType("sports")}
                >
                  <strong className="block">Bola / Olahraga</strong>
                  <span className="mt-1 block text-sm text-slate-500">
                    Mencari gol, peluang, selebrasi, dan momen berintensitas tinggi.
                  </span>
                </button>
              </div>
            </div>}

            <div className="rounded-2xl bg-slate-100 p-4">
              <div className="flex items-center gap-4">
                <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-2xl text-white">
                  PLAY
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">
                    {selectedFile
                      ? selectedFile.name
                      : metadata?.title || "Video dari link"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {selectedFile
                      ? fileSize(selectedFile.size)
                      : metadata?.is_direct_media
                        ? "Link video langsung siap diproses"
                        : "Video dari halaman sumber siap diunduh"}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-2xl text-slate-500"
                  aria-label="Hapus video"
                  onClick={() => {
                    form.resetField("file");
                    if (!selectedFile) {
                      form.setValue("source_url", "");
                      setMetadata(undefined);
                    }
                    setProgress(0);
                    setSubmissionStage("");
                  }}
                >
                  x
                </button>
              </div>
              {progress > 0 && (
                <div className="mt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {progress < 100 ? `Mengunggah... ${progress}%` : "Upload selesai"}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
              <div>
                <p className="font-bold">Data sumber video</p>
                <p className="mt-1 text-sm text-slate-500">
                  Otomatis terisi dari link. Untuk video upload, data ini dapat
                  diisi manual dan akan dimasukkan ke deskripsi.
                </p>
              </div>
              <div>
                <label htmlFor="source_url">Link sumber</label>
                <div className="flex gap-2">
                  <input
                    id="source_url"
                    placeholder="https://youtube.com/watch?v=..."
                    {...form.register("source_url")}
                  />
                  <button
                    type="button"
                    className="btn-secondary shrink-0"
                    disabled={readingLink || !sourceUrl}
                    onClick={inspectLink}
                  >
                    {readingLink ? "Membaca..." : "Ambil data"}
                  </button>
                </div>
                {urlError && <p className="mt-1 text-sm text-red-600">{urlError}</p>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="source_channel">Channel sumber</label>
                  <input
                    id="source_channel"
                    placeholder="Nama channel atau kreator"
                    {...form.register("source_channel")}
                  />
                </div>
                <div>
                  <label htmlFor="source_title">Judul video sumber</label>
                  <input
                    id="source_title"
                    placeholder={selectedFile?.name || "Judul video asli"}
                    {...form.register("source_title")}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="source_description">Keterangan sumber</label>
                <textarea
                  id="source_description"
                  rows={3}
                  placeholder="Opsional. Ringkasan atau deskripsi video sumber."
                  {...form.register("source_description")}
                />
              </div>
            </div>

            {getAiClips && <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <span className="text-sm font-black text-violet-600">AUTO</span>
              <span className="flex-1 font-semibold">
                {contentType === "sports" ? "Bahasa komentator" : "Bahasa video"}
              </span>
              <select
                className="w-auto min-w-48 border-0 text-right focus:ring-0"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="auto">Deteksi otomatis</option>
                <option value="id">Bahasa Indonesia</option>
                <option value="en">English</option>
              </select>
            </label>}

            {getAiClips && <button
              type="button"
              className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left"
            >
              <span className="text-sm font-black text-violet-600">SRT</span>
              <span className="font-semibold">
                {contentType === "sports"
                  ? "Upload subtitle komentator"
                  : "Upload file subtitle"}
              </span>
              <span className="ml-auto text-sm text-slate-400">Opsional</span>
            </button>}

            <div className={`border-l-4 p-4 text-sm ${
              manualEditorMode
                ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                : "border-violet-500 bg-violet-50 text-violet-900"
            }`}>
              <strong className="block">
                {manualEditorMode ? "Tanpa AI - langsung editor" : "AutoClip dengan AI"}
              </strong>
              <span className="mt-1 block">
                {manualEditorMode
                  ? "Video langsung disiapkan sebagai media utama di timeline editor."
                  : "Video diproses untuk transkripsi dan pencarian kandidat klip terbaik."}
              </span>
            </div>

            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
              Dengan memproses video, Anda menyatakan memiliki hak atau alasan
              penggunaan yang sesuai. Penilaian aplikasi bukan keputusan hukum.
            </p>
            {serverError && <p className="text-sm text-red-600">{serverError}</p>}
            {submissionStage && (
              <div className="rounded-xl bg-violet-50 p-3 text-center text-sm font-semibold text-violet-700">
                {submissionStage}
              </div>
            )}
            <button
              className="btn w-full py-4 text-lg"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting
                ? submissionStage || "Memproses..."
                : getAiClips
                  ? selectedFile
                    ? "Upload dan buat klip"
                    : "Unduh dan buat klip"
                  : selectedFile
                    ? "Upload dan buka editor"
                    : "Unduh dan buka editor"}
            </button>
          </div>
        )}
        {serverError && !inputReady && (
          <p className="mt-4 text-center text-sm text-red-600">{serverError}</p>
        )}
      </form>
    </div>
  );
}
