import { Action, ActionPanel, Form, Icon, Toast, showToast, Clipboard, popToRoot } from "@raycast/api";
import { useState } from "react";
import generateContent from "./tools/generate-content";
import { createFileRequest } from "./lib/dropbox-adapter";

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
  const [contentType, setContentType] = useState<string>("youtube-title");

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

  async function handleCreateDropboxFileRequest(values: FormValues) {
    if (!values.athleteName?.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Athlete name is required",
      });
      return;
    }

    setIsLoading(true);

    try {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: "Creating Dropbox file request...",
        message: values.athleteName,
      });

      const result = await createFileRequest(values.athleteName);

      if (result.success) {
        await Clipboard.copy(result.url || "");
        toast.style = Toast.Style.Success;
        toast.title = "✅ Dropbox File Request Created!";
        toast.message = `Folder: ${result.destination}`;
        await popToRoot();
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = "Failed to create file request";
        toast.message = result.error || "Unknown error";
      }
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to create Dropbox file request",
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
          <ActionPanel.Section>
            <Action.SubmitForm
              title="Generate & Copy"
              icon={Icon.Clipboard}
              onSubmit={handleSubmit}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Dropbox">
            <Action.SubmitForm
              title="Create File Request"
              icon={Icon.Folder}
              onSubmit={handleCreateDropboxFileRequest}
            />
          </ActionPanel.Section>
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
        value={contentType}
        onChange={setContentType}
        info="Select the naming format to generate"
      >
        <Form.Dropdown.Item value="youtube-title" title="YouTube Title" icon={Icon.Video} />
        <Form.Dropdown.Item value="dropbox-folder" title="Dropbox Folder" icon={Icon.Folder} />
        <Form.Dropdown.Item value="google-drive-folder" title="Google Drive Folder" icon={Icon.Folder} />
        <Form.Dropdown.Item value="approved-video-title" title="Approved Video Title" icon={Icon.Text} />
      </Form.Dropdown>

      <Form.Separator />

      {/* Grad Year - Required for all formats */}
      <Form.TextField
        id="class"
        title="Grad Year"
        placeholder="2026"
        info="Graduation year"
      />

      {/* Sport - Required for all formats */}
      <Form.TextField
        id="sport"
        title="Sport"
        placeholder="Soccer"
      />

      {/* State - Required for Dropbox/Google Drive folders */}
      {(contentType === "dropbox-folder" || contentType === "google-drive-folder") && (
        <Form.TextField
          id="state"
          title="State"
          placeholder="FL"
          info="2-letter state code"
        />
      )}

      {/* Positions - Only for Approved Video Title */}
      {contentType === "approved-video-title" && (
        <Form.TextField
          id="positions"
          title="Positions"
          placeholder="Forward | Midfielder"
          info="Pipe-separated for multi-position"
        />
      )}

      {/* High School - Only for Approved Video Title */}
      {contentType === "approved-video-title" && (
        <Form.TextField
          id="highSchool"
          title="High School"
          placeholder="Lincoln High School"
        />
      )}

      {/* City - Only for Approved Video Title */}
      {contentType === "approved-video-title" && (
        <Form.TextField
          id="city"
          title="City"
          placeholder="Miami"
        />
      )}

      {/* State - Also shown for Approved Video Title */}
      {contentType === "approved-video-title" && (
        <Form.TextField
          id="state"
          title="State"
          placeholder="FL"
          info="2-letter state code"
        />
      )}
    </Form>
  );
}
