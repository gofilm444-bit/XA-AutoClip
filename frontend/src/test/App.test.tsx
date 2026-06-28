import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "../App";

describe("App", () => {
  it("menampilkan formulir proyek baru", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/projects/new"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Masukkan video Anda" }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Paste link video sumber")).toBeInTheDocument();
    expect(screen.getByText(/klik untuk memilih atau drag & drop/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Status kepemilikan")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tujuan transformasi")).not.toBeInTheDocument();
  });
});
