import type { Transformation } from "../types";

type TransformationStyleSource =
  | Pick<Transformation, "clipper_style_config">
  | null
  | undefined;

export function isManualEditorTransformation(transformation: TransformationStyleSource) {
  return Boolean(transformation?.clipper_style_config?.manual_editor_mode);
}

export function hasManualEditorTimelineVideo(transformation: TransformationStyleSource) {
  return Boolean(
    (transformation?.clipper_style_config?.video_sequence || []).length &&
      !transformation?.clipper_style_config?.video_track_deleted,
  );
}

export function initialEditorContext(transformation: TransformationStyleSource) {
  return isManualEditorTransformation(transformation) &&
    !hasManualEditorTimelineVideo(transformation)
    ? ("media" as const)
    : ("video" as const);
}
