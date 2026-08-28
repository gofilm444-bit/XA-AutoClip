import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

export type BlankManualEditorResponse = {
  project_id: string;
  transformation_id: string;
  editor_url: string;
  status: string;
};

export function useBlankManualEditor() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () =>
      api<BlankManualEditorResponse>("/api/projects/manual-editor/blank", {
        method: "POST",
      }),
    onSuccess: (data) => navigate(data.editor_url),
  });
}
