export type AthleteIdentity = {
  athleteId: string;
  athleteMainId: string;
  athleteKey: string;
};

export function normalizeAthleteId(value?: string | number | null): string {
  return String(value || '').trim();
}

export function normalizeAthleteMainId(value?: string | number | null): string {
  return String(value || '').trim();
}

export function buildAthleteKey(athleteId: string | number, athleteMainId: string | number): string {
  const normalizedAthleteId = normalizeAthleteId(athleteId);
  const normalizedAthleteMainId = normalizeAthleteMainId(athleteMainId);
  if (!normalizedAthleteId || !normalizedAthleteMainId) {
    throw new Error(
      `Malformed athlete identity: athlete_id=${normalizedAthleteId || 'missing'} athlete_main_id=${
        normalizedAthleteMainId || 'missing'
      }`,
    );
  }
  return `${normalizedAthleteId}:${normalizedAthleteMainId}`;
}

export function validateAthleteIdentity(args: {
  athleteId?: string | number | null;
  athleteMainId?: string | number | null;
}): AthleteIdentity {
  const athleteId = normalizeAthleteId(args.athleteId);
  const athleteMainId = normalizeAthleteMainId(args.athleteMainId);
  return {
    athleteId,
    athleteMainId,
    athleteKey: buildAthleteKey(athleteId, athleteMainId),
  };
}

export function sameAthleteIdentity(args: {
  athleteId?: string | number | null;
  athleteMainId?: string | number | null;
  candidateAthleteId?: string | number | null;
  candidateAthleteMainId?: string | number | null;
}): boolean {
  const athleteId = normalizeAthleteId(args.athleteId);
  const athleteMainId = normalizeAthleteMainId(args.athleteMainId);
  const candidateAthleteId = normalizeAthleteId(args.candidateAthleteId);
  const candidateAthleteMainId = normalizeAthleteMainId(args.candidateAthleteMainId);

  if (!athleteId || !athleteMainId) return false;
  if (!candidateAthleteId && !candidateAthleteMainId) return true;
  return athleteId === candidateAthleteId && athleteMainId === candidateAthleteMainId;
}
