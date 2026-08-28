import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import * as apiClient from "../api/client";
import { NewProjectPage } from "../pages/NewProjectPage";
import type { Project } from "../types";

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderApp(path: string) {
  return render(
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App", () => {
  it("membuka mode editor manual sebagai default proyek baru", () => {
    renderApp("/projects/new");

    expect(screen.getByRole("heading", { name: "Edit Video Sendiri" })).toBeInTheDocument();
    expect(screen.getAllByText(/tanpa AI - langsung editor/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /AutoClip Video Panjang/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Paste link video sumber")).toBeInTheDocument();
  });

  it("tetap menyediakan mode AutoClip melalui query mode", () => {
    renderApp("/projects/new?mode=autoclip");

    expect(screen.getByRole("heading", { name: "Masukkan video panjang" })).toBeInTheDocument();
    expect(screen.getAllByText(/AI mencari kandidat klip terbaik/i).length).toBeGreaterThan(0);
  });

  it("submit manual memanggil endpoint manual editor dan redirect", async () => {
    const project = {
      id: "project-manual",
      title: "Manual",
      description: null,
      content_type: "podcast",
      transcript_provider: null,
      transcript_language: null,
      status: "created",
      created_at: "2026-08-28T00:00:00Z",
      updated_at: "2026-08-28T00:00:00Z",
    } satisfies Project;
    const api = vi.spyOn(apiClient, "api").mockImplementation(async (path) => {
      if (path === "/api/projects") return project as never;
      if (path === "/api/projects/project-manual/manual-editor") {
        return {
          project_id: project.id,
          candidate_id: "candidate-manual",
          transformation_id: "transformation-manual",
          editor_url: "/transformations/transformation-manual",
          status: "ready_for_edit",
          duration: 12,
        } as never;
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    const upload = vi.spyOn(apiClient, "upload").mockResolvedValue({} as never);
    const view = render(
      <QueryClientProvider client={queryClient()}>
        <MemoryRouter initialEntries={["/projects/new"]}>
          <Routes>
            <Route path="/projects/new" element={<NewProjectPage />} />
            <Route
              path="/transformations/:transformationId"
              element={<p>Editor manual terbuka</p>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, {
      target: { files: [new File(["video"], "manual.mp4", { type: "video/mp4" })] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Upload dan buka editor" }));

    expect(await screen.findByText("Editor manual terbuka")).toBeInTheDocument();
    expect(upload).toHaveBeenCalledWith(
      "/api/projects/project-manual/source",
      expect.any(File),
      expect.any(Function),
    );
    expect(api).toHaveBeenCalledWith(
      "/api/projects/project-manual/manual-editor",
      { method: "POST" },
    );
    expect(api.mock.calls.some(([path]) => path.endsWith("/process"))).toBe(false);
  });

  it("dashboard editor-first tetap menyediakan AutoClip dan mengenali proyek manual", async () => {
    const api = vi.spyOn(apiClient, "api").mockImplementation(async (path) => {
      if (path === "/api/projects") {
        return [
          {
            id: "project-manual",
            title: "Video manual",
            description: null,
            content_type: "podcast",
            transcript_provider: "manual_skipped",
            transcript_language: null,
            status: "transformation_draft",
            created_at: "2026-08-28T00:00:00Z",
            updated_at: "2026-08-28T00:00:00Z",
            manual_editor_url: "/transformations/transformation-manual",
          },
        ] as never;
      }
      if (path === "/api/projects/manual-editor/blank") {
        return {
          project_id: "project-blank",
          transformation_id: "transformation-blank",
          editor_url: "/transformations/transformation-blank",
          status: "transformation_draft",
        } as never;
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderApp("/");

    expect(screen.getByRole("heading", { name: /Edit video cepat/i })).toBeInTheDocument();
    const mulaiEdit = screen.getByRole("button", { name: "Mulai Edit" });
    expect(mulaiEdit).toBeInTheDocument();
    expect(screen.getAllByText("Buat AutoClip").length).toBeGreaterThan(0);
    expect(await screen.findByText("Mode edit manual")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Buka editor" })).toHaveAttribute(
        "href",
        "/transformations/transformation-manual",
      );
    });
    fireEvent.click(mulaiEdit);
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/api/projects/manual-editor/blank", { method: "POST" });
    });
  });
});
