import { Action, ActionPanel, Icon, List, Toast, showToast } from "@raycast/api";
import { useEffect, useState } from "react";
import { Client } from "@notionhq/client";
import { getPreferenceValues } from "@raycast/api";

// CORRECT DATABASE ID (without dashes)
const DATABASE_ID = "19f4c8bd6c26805b9929dfa8eb290a86";

type Task = {
  id: string;
  name: string;
  status: string;
  sport: string[];
  class: string;
  duration: string;
  dueDate: string;
  playerId?: string;
};

function getNotion() {
  const { notionToken } = getPreferenceValues();
  return new Client({ 
    auth: notionToken,
    notionVersion: "2022-06-28" 
  });
}

async function fetchActiveTasks(): Promise<Task[]> {
  const notion = getNotion();
  
  const response = await notion.databases.query({
    database_id: "19f4c8bd6c26805b9929dfa8eb290a86", // Your actual database ID
    filter: {
      or: [
        { property: "Status", status: { equals: "Revise" } },
        { property: "Status", status: { equals: "HUDL" } },
        { property: "Status", status: { equals: "Dropbox" } },
        { property: "Status", status: { equals: "Not Approved" } },
        { property: "Status", status: { equals: "Uploads" } }
      ]
    },
    sorts: [{ property: "Due Date", direction: "ascending" }],
  });

  return response.results.map((task: any) => ({
    id: task.id,
    name: task.properties["Name"]?.title?.[0]?.plain_text || "",
    status: task.properties["Status"]?.status?.name || "INBOX",
    sport: task.properties["Sport"]?.multi_select?.map((s: any) => s.name) || [],
    class: task.properties["Class"]?.select?.name || "",
    duration: task.properties["Duration"]?.select?.name || "",
    dueDate: task.properties["Due Date"]?.date?.start || "",
    playerId: task.properties["PlayerID"]?.url || "",
  }));
}

function getStatusIcon(status: string) {
  switch (status) {
    case "Revise": return Icon.ArrowClockwise;
    case "HUDL": return Icon.CircleFilled;
    case "Dropbox": return Icon.Folder;
    case "Not Approved": return Icon.XMarkCircle;
    case "Uploads": return Icon.ArrowUp;
    default: return Icon.Circle;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "Revise": return "#AF52DE";
    case "HUDL": return "#FF3B30";
    case "Dropbox": return "#007AFF";
    case "Not Approved": return "#FF9500";
    case "Uploads": return "#FF2D92";
    default: return "#8E8E93";
  }
}

function formatDate(dateString: string): string {
  if (!dateString) return "No due date";
  return new Date(dateString).toLocaleDateString();
}

export default function ActiveTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    try {
      setIsLoading(true);
      const activeTasks = await fetchActiveTasks();
      setTasks(activeTasks);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to load tasks",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Active Video Tasks"
      searchBarPlaceholder="Search video tasks..."
      actions={
        <ActionPanel>
          <Action
            title="Reload Tasks"
            icon={Icon.ArrowClockwise}
            onAction={loadTasks}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
          />
        </ActionPanel>
      }
    >
      <List.Section title="In Progress Tasks">
        {tasks.map((task) => (
          <List.Item
            key={task.id}
            title={task.name}
            subtitle={`${task.class} • ${task.sport.join(", ")}`}
            accessories={[
              { text: formatDate(task.dueDate) },
              { 
                icon: { 
                  source: getStatusIcon(task.status), 
                  tintColor: getStatusColor(task.status) 
                },
                text: task.status 
              }
            ]}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser
                  title="Open in Notion"
                  url={`https://www.notion.so/${task.id.replace(/-/g, "")}`}
                  icon={Icon.ArrowNe}
                  shortcut={{ modifiers: ["cmd"], key: "return" }}
                />
                {task.playerId && (
                  <Action.OpenInBrowser
                    title="Open Player Profile"
                    url={task.playerId}
                    icon={Icon.Person}
                  />
                )}
                <Action.CopyToClipboard
                  title="Copy Task Name"
                  content={task.name}
                  icon={Icon.CopyClipboard}
                />
                <Action
                  title="Reload Tasks"
                  icon={Icon.ArrowClockwise}
                  onAction={loadTasks}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
