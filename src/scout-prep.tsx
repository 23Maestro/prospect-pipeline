import { Action, ActionPanel, Color, Detail, Form, Toast, showToast, useNavigation } from '@raycast/api';
import { useState } from 'react';
import { buildScoutPrepMarkdown } from './features/scout-prep/content';
import type { ScoutPrepFormValues } from './features/scout-prep/types';

function ScoutPrepResult({ values }: { values: ScoutPrepFormValues }) {
  return (
    <Detail
      navigationTitle={`Scout Prep • ${values.athleteName}`}
      markdown={buildScoutPrepMarkdown(values)}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Student Athlete">
            <Detail.Metadata.TagList.Item text={values.athleteName} color={Color.Blue} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.TagList title="Parent 1">
            <Detail.Metadata.TagList.Item text={values.parent1Name} color={Color.Green} />
          </Detail.Metadata.TagList>
          {values.parent2Name ? (
            <Detail.Metadata.TagList title="Parent 2">
              <Detail.Metadata.TagList.Item text={values.parent2Name} color={Color.Magenta} />
            </Detail.Metadata.TagList>
          ) : null}
          <Detail.Metadata.TagList title="Grade">
            <Detail.Metadata.TagList.Item text={values.gradYear} color={Color.Orange} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.TagList title="Sport">
            <Detail.Metadata.TagList.Item text={values.sport} color={Color.Purple} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Separator />
          <Detail.Metadata.TagList title="Mode">
            <Detail.Metadata.TagList.Item text="Digital Recruit" color={Color.Red} />
          </Detail.Metadata.TagList>
        </Detail.Metadata>
      }
    />
  );
}

export default function ScoutPrepCommand() {
  const { push } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(values: ScoutPrepFormValues) {
    if (isSubmitting) {
      return;
    }

    const athleteName = values.athleteName.trim();
    const parent1Name = values.parent1Name.trim();
    const parent2Name = (values.parent2Name || '').trim();
    const sport = values.sport.trim();

    if (!athleteName || !parent1Name || !values.gradYear || !sport) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Student athlete, parent 1, grad year, and sport are required',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      push(
        <ScoutPrepResult
          values={{
            athleteName,
            parent1Name,
            parent2Name,
            gradYear: values.gradYear,
            sport,
          }}
        />,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      navigationTitle="Scout Prep"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={isSubmitting ? 'Building…' : 'Build Scout Prep'}
            onSubmit={(values) => void handleSubmit(values as ScoutPrepFormValues)}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="athleteName" title="Student Athlete" placeholder="Student Athlete" />
      <Form.TextField id="parent1Name" title="Parent 1" placeholder="Parent 1" />
      <Form.TextField id="parent2Name" title="Parent 2" placeholder="Parent 2" />
      <Form.Dropdown id="gradYear" title="Grad Year" defaultValue="Junior">
        <Form.Dropdown.Item value="Freshman" title="Freshman" />
        <Form.Dropdown.Item value="Sophomore" title="Sophomore" />
        <Form.Dropdown.Item value="Junior" title="Junior" />
        <Form.Dropdown.Item value="Senior" title="Senior" />
      </Form.Dropdown>
      <Form.TextField id="sport" title="Sport" placeholder="Sport" />
    </Form>
  );
}
