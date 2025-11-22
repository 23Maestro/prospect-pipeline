import { Action, ActionPanel, Form, Icon, Toast, showToast, Clipboard, popToRoot } from "@raycast/api";
import { useState, useCallback } from "react";
import generateContent from "./tools/generate-content";
import { createFileRequest } from "./lib/dropbox-adapter";
import { NPIDClient } from "./lib/npid-client-raycast";
import type { AthleteSummary, AthleteDetails } from "./types/athlete";

type FormValues = {
  athleteName: string;
  sport: string;
  class: string;
  positions: string;
  highSchool: string;
  city: string;
  state: string;
  jerseyNumber: string;
  seasonName: string;
  contentType: string;
};

export default function Command() {
  const [isLoading, setIsLoading] = useState(false);
  const [contentType, setContentType] = useState<string>("youtube-title");

  // Athlete search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AthleteSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedAthlete, setSelectedAthlete] = useState<AthleteDetails | null>(null);
  const [formValues, setFormValues] = useState<Partial<FormValues>>({});

  const npidClient = new NPIDClient();

  // Debounced athlete search
  const handleAthleteSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query);

      if (!query || query.length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const results = await npidClient.searchPlayer(query);
        setSearchResults(results);
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Search failed",
          message: error instanceof Error ? error.message : "Unknown error",
        });
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    []
  );

  // Handle athlete selection and auto-fill
  const handleAthleteSelect = useCallback(
    async (athleteId: string) => {
      if (!athleteId) {
        setSelectedAthlete(null);
        setFormValues({});
        return;
      }

      setIsLoading(true);
      try {
        const details = await npidClient.getAthleteDetails(athleteId);
        if (!details) {
          throw new Error("Could not fetch athlete details");
        }

        setSelectedAthlete(details);

        // Auto-fill form values
        setFormValues({
          athleteName: details.name,
          sport: details.sport,
          class: details.gradYear?.toString() || "",
          positions: details.positions || "",
          highSchool: details.highSchool || "",
          city: details.city || "",
          state: details.state || "",
          seasonName: details.seasonName || "",
        });

        await showToast({
          style: Toast.Style.Success,
          title: "Athlete selected",
          message: `Auto-filled data for ${details.name}`,
        });
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to load athlete",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  async function handleSubmit(values: FormValues) {
    // Merge form submission values with controlled formValues state
    const mergedValues = { ...formValues, ...values };

    if (!mergedValues.athleteName?.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Athlete name is required",
      });
      return;
    }

    setIsLoading(true);

    try {
      const result = await generateContent({
        athleteName: mergedValues.athleteName,
        sport: mergedValues.sport,
        class: mergedValues.class,
        positions: mergedValues.positions,
        highSchool: mergedValues.highSchool,
        city: mergedValues.city,
        state: mergedValues.state,
        jerseyNumber: mergedValues.jerseyNumber,
        seasonName: mergedValues.seasonName,
        contentType: mergedValues.contentType as any,
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
    // Merge form submission values with controlled formValues state
    const mergedValues = { ...formValues, ...values };

    if (!mergedValues.athleteName?.trim()) {
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
        message: mergedValues.athleteName,
      });

      const result = await createFileRequest(mergedValues.athleteName);

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

      <Form.Dropdown
        id="athleteSearch"
        title="Search Athlete"
        value={selectedAthlete?.id || ""}
        onChange={handleAthleteSelect}
        isLoading={isSearching}
        onSearchTextChange={handleAthleteSearch}
        throttle={true}
      >
        {searchResults.length === 0 && !searchQuery && (
          <Form.Dropdown.Item value="" title="Type to search athletes..." icon={Icon.MagnifyingGlass} />
        )}
        {searchResults.length === 0 && searchQuery && !isSearching && (
          <Form.Dropdown.Item value="" title="No results found" icon={Icon.XMarkCircle} />
        )}
        {searchResults.map((athlete) => (
          <Form.Dropdown.Item
            key={athlete.id}
            value={athlete.id}
            title={athlete.name}
            icon={Icon.Person}
            accessories={[
              { text: `${athlete.gradYear} • ${athlete.sport}` },
              { text: athlete.state },
            ]}
          />
        ))}
      </Form.Dropdown>

      <Form.TextField
        id="athleteName"
        title="Athlete Name"
        placeholder="John Smith"
        value={formValues.athleteName || ""}
        onChange={(value) => setFormValues({ ...formValues, athleteName: value })}
        info="Auto-filled from search or enter manually"
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
        value={formValues.class || ""}
        onChange={(value) => setFormValues({ ...formValues, class: value })}
        info="Graduation year"
      />

      {/* Sport - Required for all formats */}
      <Form.TextField
        id="sport"
        title="Sport"
        placeholder="Soccer"
        value={formValues.sport || ""}
        onChange={(value) => setFormValues({ ...formValues, sport: value })}
      />

      {/* State - Required for Dropbox/Google Drive folders */}
      {(contentType === "dropbox-folder" || contentType === "google-drive-folder") && (
        <Form.TextField
          id="state"
          title="State"
          placeholder="FL"
          value={formValues.state || ""}
          onChange={(value) => setFormValues({ ...formValues, state: value })}
          info="2-letter state code"
        />
      )}

      {/* Positions - Only for Approved Video Title */}
      {contentType === "approved-video-title" && (
        <Form.TextField
          id="positions"
          title="Positions"
          placeholder="Forward | Midfielder"
          value={formValues.positions || ""}
          onChange={(value) => setFormValues({ ...formValues, positions: value })}
          info="Pipe-separated for multi-position"
        />
      )}

      {/* High School - Only for Approved Video Title */}
      {contentType === "approved-video-title" && (
        <Form.TextField
          id="highSchool"
          title="High School"
          placeholder="Lincoln High School"
          value={formValues.highSchool || ""}
          onChange={(value) => setFormValues({ ...formValues, highSchool: value })}
        />
      )}

      {/* City - Only for Approved Video Title */}
      {contentType === "approved-video-title" && (
        <Form.TextField
          id="city"
          title="City"
          placeholder="Miami"
          value={formValues.city || ""}
          onChange={(value) => setFormValues({ ...formValues, city: value })}
        />
      )}

      {/* State - Also shown for Approved Video Title */}
      {contentType === "approved-video-title" && (
        <Form.TextField
          id="state"
          title="State"
          placeholder="FL"
          value={formValues.state || ""}
          onChange={(value) => setFormValues({ ...formValues, state: value })}
          info="2-letter state code"
        />
      )}

      {/* Jersey Number - Optional for Approved Video Title */}
      {contentType === "approved-video-title" && (
        <Form.TextField
          id="jerseyNumber"
          title="Jersey Number"
          placeholder="12"
          value={formValues.jerseyNumber || ""}
          onChange={(value) => setFormValues({ ...formValues, jerseyNumber: value })}
          info="Optional"
        />
      )}

      {/* Season Name - For YouTube Title */}
      {contentType === "youtube-title" && (
        <Form.Dropdown
          id="seasonName"
          title="Season"
          value={formValues.seasonName || ""}
          onChange={(value) => setFormValues({ ...formValues, seasonName: value })}
          info="Select current season"
        >
          <Form.Dropdown.Item value="7th Grade Season" title="7th Grade Season" />
          <Form.Dropdown.Item value="8th Grade Season" title="8th Grade Season" />
          <Form.Dropdown.Item value="Freshman Season" title="Freshman Season" />
          <Form.Dropdown.Item value="Sophomore Season" title="Sophomore Season" />
          <Form.Dropdown.Item value="Junior Season" title="Junior Season" />
          <Form.Dropdown.Item value="Senior Season" title="Senior Season" />
        </Form.Dropdown>
      )}
    </Form>
  );
}
