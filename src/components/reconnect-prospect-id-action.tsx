import { Action, Icon } from '@raycast/api';
import type { ComponentProps } from 'react';
import { reconnectProspectIdSession } from '../lib/npid-auth-recovery';

type ReconnectProspectIdActionProps = {
  onReconnectSuccess?: () => Promise<void> | void;
  shortcut?: ComponentProps<typeof Action>['shortcut'];
  title?: string;
};

export function ReconnectProspectIdAction({
  onReconnectSuccess,
  shortcut = { modifiers: ['shift', 'opt'], key: 'r' },
  title = 'Reconnect Prospect ID Session',
}: ReconnectProspectIdActionProps) {
  return (
    <Action
      title={title}
      icon={Icon.ArrowClockwise}
      shortcut={shortcut}
      onAction={() => void reconnectProspectIdSession(onReconnectSuccess)}
    />
  );
}
