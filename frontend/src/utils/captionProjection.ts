export type CaptionSourceCue = {
  start: number;
  end: number;
  text: string;
};

export type CaptionSourceSegment = {
  id: string;
  sourceStart: number;
  sourceEnd: number;
};

export type ProjectedCaptionCue = CaptionSourceCue & {
  id: string;
};

const roundTime = (value: number) => Number(value.toFixed(3));

export function projectCaptionCues(
  sourceCues: CaptionSourceCue[],
  videoSequence: CaptionSourceSegment[],
): ProjectedCaptionCue[] {
  const orderedCues = sourceCues
    .map((cue, sourceIndex) => ({ ...cue, sourceIndex }))
    .filter(
      (cue) =>
        Number.isFinite(cue.start) &&
        Number.isFinite(cue.end) &&
        cue.end > cue.start,
    )
    .sort((left, right) => left.start - right.start || left.sourceIndex - right.sourceIndex);
  const projected: ProjectedCaptionCue[] = [];
  let outputOffset = 0;

  videoSequence.forEach((segment, sequenceIndex) => {
    const sourceStart = Number(segment.sourceStart);
    const sourceEnd = Number(segment.sourceEnd);
    if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) {
      return;
    }

    orderedCues.forEach((cue) => {
      const overlapStart = Math.max(sourceStart, cue.start);
      const overlapEnd = Math.min(sourceEnd, cue.end);
      if (overlapEnd - overlapStart <= 0.001) return;

      projected.push({
        id: `caption-sync-${sequenceIndex}-${cue.sourceIndex}-${segment.id}`,
        start: roundTime(outputOffset + overlapStart - sourceStart),
        end: roundTime(outputOffset + overlapEnd - sourceStart),
        text: String(cue.text || "").trim(),
      });
    });

    outputOffset += sourceEnd - sourceStart;
  });

  return projected;
}
