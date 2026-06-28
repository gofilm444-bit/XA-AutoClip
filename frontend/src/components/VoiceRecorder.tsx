import { useRef, useState } from "react";
import { upload } from "../api/client";

export function VoiceRecorder({ projectId, onUploaded }: {
  projectId: string;
  onUploaded: () => void;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>();
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks.current = [];
    recorder.current = new MediaRecorder(stream);
    recorder.current.ondataavailable = (event) => chunks.current.push(event.data);
    recorder.current.onstop = () => {
      const blob = new Blob(chunks.current, { type: "audio/webm" });
      setAudioUrl(URL.createObjectURL(blob));
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.current.start();
    setRecording(true);
  }

  function stop() {
    recorder.current?.stop();
    setRecording(false);
  }

  async function submitRecording() {
    setUploading(true);
    try {
      const blob = new Blob(chunks.current, { type: "audio/webm" });
      await upload(`/api/projects/${projectId}/voiceover`, new File([blob], "voiceover.webm"));
      setMessage("Voice-over berhasil disimpan.");
      onUploaded();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Voice-over gagal disimpan.");
    } finally {
      setUploading(false);
    }
  }

  async function submitFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setMessage("Pilih file audio yang didukung.");
      return;
    }
    setUploading(true);
    try {
      await upload(`/api/projects/${projectId}/voiceover`, file);
      setMessage("Voice-over berhasil diunggah.");
      onUploaded();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Voice-over gagal diunggah.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="panel space-y-4">
      <div>
        <h2 className="text-lg font-bold">Voice-over kreator</h2>
        <p className="text-sm text-zinc-400">Rekam komentar Anda atau unggah audio.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {!recording ? (
          <button type="button" className="btn-secondary" onClick={start}>Mulai rekam</button>
        ) : (
          <button type="button" className="btn" onClick={stop}>Stop</button>
        )}
        {audioUrl && <audio controls src={audioUrl} />}
        {audioUrl && (
          <button type="button" className="btn" disabled={uploading} onClick={submitRecording}>
            {uploading ? "Mengunggah..." : "Gunakan rekaman"}
          </button>
        )}
      </div>
      <input
        aria-label="Unggah voice-over"
        type="file"
        accept="audio/*"
        disabled={uploading}
        onChange={(event) => submitFile(event.target.files?.[0])}
      />
      {message && <p className="text-sm text-cyan-300">{message}</p>}
    </section>
  );
}
