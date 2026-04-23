import { AI, environment } from '@raycast/api';
import type { ParentHonorific } from './scout-prep-contact';

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
