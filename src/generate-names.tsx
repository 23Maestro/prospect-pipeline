import { Action, ActionPanel, Form, Icon, Toast, showToast, Clipboard, popToRoot } from "@raycast/api";
import { useState } from "react";
import generateContent from "./tools/generate-content";

type FormValues = {
  athleteName: string;
  sport: string;
  class: string;
  positions: string;
  highSchool: string;
  city: string;
  state: string;
  contentType: string;
};

export default function Command() {
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: FormValues) {
    if (!values.athleteName?.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Athlete name is required",
      });
      return;
    }

    setIsLoading(true);

    try {
      const result = await generateContent({
        athleteName: values.athleteName,
        sport: values.sport,
        class: values.class,
        positions: values.positions,
        highSchool: values.highSchool,
        city: values.city,
        state: values.state,
        contentType: values.contentType as any,
      });

      await Clipboard.copy(result);
      await showToast({
        style: Toast.Style.Success,
        title: "Copied to clipboard!",
        message: result,
      });

      await popToRoot();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to generate",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Generate & Copy"
            icon={Icon.Clipboard}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Generate naming conventions for student athletes" />

      <Form.Separator />

      <Form.TextField
        id="athleteName"
        title="Athlete Name"
        placeholder="John Smith"
        info="Full name of the student athlete"
      />

      <Form.Dropdown
        id="contentType"
        title="Format"
        defaultValue="youtube-title"
        info="Select the naming format to generate"
      >
        <Form.Dropdown.Item value="youtube-title" title="YouTube Title" icon={Icon.Video} />
        <Form.Dropdown.Item value="dropbox-folder" title="Dropbox Folder" icon={Icon.Folder} />
        <Form.Dropdown.Item value="google-drive-folder" title="Google Drive Folder" icon={Icon.Folder} />
        <Form.Dropdown.Item value="approved-video-title" title="Approved Video Title" icon={Icon.Text} />
      </Form.Dropdown>

      <Form.Separator />

      <Form.TextField
        id="class"
        title="Grad Year"
        placeholder="2026"
        info="Graduation year"
      />

      <Form.TextField
        id="sport"
        title="Sport"
        placeholder="Soccer"
      />

      <Form.TextField
        id="positions"
        title="Positions"
        placeholder="Forward | Midfielder"
        info="Pipe-separated for multi-position (only used in Approved Video Title)"
      />

      <Form.TextField
        id="highSchool"
        title="High School"
        placeholder="Lincoln High School"
      />

      <Form.TextField
        id="city"
        title="City"
        placeholder="Miami"
      />

      <Form.TextField
        id="state"
        title="State"
        placeholder="FL"
        info="2-letter state code"
      />
    </Form>
  );
}
