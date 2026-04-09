import { LaunchProps } from '@raycast/api';
import EmailStudentAthletesView, {
  type EmailStudentAthletesFormValues,
  type EmailStudentAthletesViewProps,
} from './features/athlete-workflows/email-student-athletes-view';

export type { EmailStudentAthletesFormValues, EmailStudentAthletesViewProps };

export default function EmailStudentAthletesCommand(
  props:
    | LaunchProps<{ draftValues: EmailStudentAthletesFormValues }>
    | EmailStudentAthletesViewProps,
) {
  return <EmailStudentAthletesView {...props} />;
}
