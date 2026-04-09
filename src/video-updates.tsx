import { LaunchProps } from '@raycast/api';
import VideoUpdatesView, {
  type VideoUpdatesViewProps,
} from './features/athlete-workflows/video-updates-view';
import type { VideoUpdateFormValues } from './types/athlete-workflows';

export type { VideoUpdateFormValues, VideoUpdatesViewProps };

export default function VideoUpdatesCommand(
  props: LaunchProps<{ draftValues: VideoUpdateFormValues }> | VideoUpdatesViewProps,
) {
  return <VideoUpdatesView {...props} enableDrafts />;
}
