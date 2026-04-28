import { AI, environment } from '@raycast/api';
import type { ParentHonorific } from './scout-prep-contact';
import { resolveAthleteGenderFromSport, type AthleteGender } from './scout-follow-up-templates';

function normalizeHonorific(value: string): ParentHonorific | null {
  const normalized = String(value || '').trim();
  if (/^ms\.$/i.test(normalized)) return 'Ms.';
  if (/^mr\.$/i.test(normalized)) return 'Mr.';
  return null;
}

export async function resolveParentHonorificWithRayAI(args: {
  parentName?: string | null;
  relationship?: string | null;
}): Promise<ParentHonorific | null> {
  if (!environment.canAccess(AI)) {
    return null;
  }

  const answer = await AI.ask(
    [
      'Return exactly one honorific for this parent: Mr. or Ms.',
      'Use Ms. for mom, mother, maternal labels, or a clearly female name.',
      'Use Mr. for dad, father, or paternal labels.',
      'If unsure, return an empty string.',
      `Parent name: ${String(args.parentName || '').trim()}`,
      `Backend relationship: ${String(args.relationship || '').trim()}`,
    ].join('\n'),
    { creativity: 'none' },
  );

  return normalizeHonorific(answer);
}

function normalizeAthleteGender(value: string): AthleteGender | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'female') return 'female';
  if (normalized === 'male') return 'male';
  return null;
}

export async function resolveAthleteGenderWithRayAI(args: {
  athleteName?: string | null;
  sport?: string | null;
}): Promise<AthleteGender | null> {
  const deterministicGender = resolveAthleteGenderFromSport(args.sport);
  if (deterministicGender) {
    return deterministicGender;
  }

  if (!environment.canAccess(AI)) {
    return null;
  }

  const answer = await AI.ask(
    [
      'Return exactly one athlete gender label: male or female.',
      'Use sport context first. Softball and clearly girls/women sports are female.',
      'Use the athlete first name only if it is obvious.',
      'If unsure, return an empty string.',
      `Athlete name: ${String(args.athleteName || '').trim()}`,
      `Sport: ${String(args.sport || '').trim()}`,
    ].join('\n'),
    { creativity: 'none' },
  );

  return normalizeAthleteGender(answer);
}
