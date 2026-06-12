import { updateCommandMetadata } from '@raycast/api';
import { reconcilePendingScheduledFollowUpUpdates } from './lib/scheduled-follow-up-reconciler';

export default async function Command() {
  const results = await reconcilePendingScheduledFollowUpUpdates();
  const applied = results.filter((result) => result.status === 'applied').length;
  const waiting = results.filter((result) => result.status === 'waiting').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const expired = results.filter((result) => result.status === 'expired').length;

  await updateCommandMetadata({
    subtitle: applied
      ? `Applied ${applied} scheduled follow-up${applied === 1 ? '' : 's'}`
      : waiting
        ? `Waiting on ${waiting} follow-up task${waiting === 1 ? '' : 's'}`
        : failed || expired
          ? `${failed} failed, ${expired} expired`
          : 'No pending follow-ups',
  });
}
