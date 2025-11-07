import { Action, ActionPanel, Icon, List, Toast, showToast, Detail, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import { Client } from "@notionhq/client";
import { getPreferenceValues } from "@raycast/api";

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

async function fetchPageContent(pageId: string): Promise<string> {
  const notion = getNotion();
  try {
    // Fetch page blocks (content) with pagination
    let allBlocks: any[] = [];
    let hasMore = true;
    let startCursor: string | undefined;

    while (hasMore) {
      const response = await notion.blocks.children.list({
        block_id: pageId,
        start_cursor: startCursor,
        page_size: 100
      });
      allBlocks = allBlocks.concat(response.results);
      hasMore = response.has_more;
      startCursor = response.next_cursor || undefined;
    }

    let content = "";
    for (const block of allBlocks) {
      const anyBlock = block as any;

      if (anyBlock.type === "paragraph" && anyBlock.paragraph?.rich_text) {
        const text = anyBlock.paragraph.rich_text.map((t: any) => t.plain_text).join("");
        if (text.trim()) content += text + "\n\n";
      } else if (anyBlock.type === "heading_1" && anyBlock.heading_1?.rich_text) {
        content += "# " + anyBlock.heading_1.rich_text.map((t: any) => t.plain_text).join("") + "\n\n";
      } else if (anyBlock.type === "heading_2" && anyBlock.heading_2?.rich_text) {
        content += "## " + anyBlock.heading_2.rich_text.map((t: any) => t.plain_text).join("") + "\n\n";
      } else if (anyBlock.type === "heading_3" && anyBlock.heading_3?.rich_text) {
        content += "### " + anyBlock.heading_3.rich_text.map((t: any) => t.plain_text).join("") + "\n\n";
      } else if (anyBlock.type === "bulleted_list_item" && anyBlock.bulleted_list_item?.rich_text) {
        const text = anyBlock.bulleted_list_item.rich_text.map((t: any) => t.plain_text).join("");
        if (text.trim()) content += "- " + text + "\n";
      } else if (anyBlock.type === "numbered_list_item" && anyBlock.numbered_list_item?.rich_text) {
        const text = anyBlock.numbered_list_item.rich_text.map((t: any) => t.plain_text).join("");
        if (text.trim()) content += "1. " + text + "\n";
      } else if (anyBlock.type === "quote" && anyBlock.quote?.rich_text) {
        content += "> " + anyBlock.quote.rich_text.map((t: any) => t.plain_text).join("") + "\n\n";
      } else if (anyBlock.type === "code" && anyBlock.code?.rich_text) {
        const lang = anyBlock.code.language || "text";
        content += "```" + lang + "\n" + anyBlock.code.rich_text.map((t: any) => t.plain_text).join("") + "\n```\n\n";
      } else if (anyBlock.type === "divider") {
        content += "---\n\n";
      } else if (anyBlock.type === "table") {
        // Table blocks have children that contain table rows
        content += "[Table content]\n\n";
      } else if (anyBlock.type === "image" && anyBlock.image?.external?.url) {
        content += `![Image](${anyBlock.image.external.url})\n\n`;
      } else if (anyBlock.type === "bookmark" && anyBlock.bookmark?.url) {
        content += `[Bookmark: ${anyBlock.bookmark.url}]\n\n`;
      }
    }

    return content.trim() || "No content found in this page.";
  } catch (error) {
    return `Failed to fetch page content: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

async function updateTaskStatus(pageId: string, newStatus: string): Promise<boolean> {
  const notion = getNotion();
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: {
        Status: {
          status: { name: newStatus }
        }
      }
    });
    return true;
  } catch (error) {
    console.error("Failed to update task status:", error);
    return false;
  }
}

function PageContentView({ task, onBack, onStatusUpdate }: { task: Task; onBack: () => void; onStatusUpdate: () => void }) {
  const [content, setContent] = useState<string>("Loading page content...");
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    const loadContent = async () => {
      try {
        setIsLoading(true);
        const pageContent = await fetchPageContent(task.id);
        setContent(pageContent);
      } catch (error) {
        setContent(`Error loading content: ${error instanceof Error ? error.message : "Unknown error"}`);
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, [task.id]);

  const handleStatusChange = async (newStatus: string) => {
    setIsUpdating(true);
    try {
      const success = await updateTaskStatus(task.id, newStatus);
      if (success) {
        await showToast({
          style: Toast.Style.Success,
          title: "Status Updated",
          message: `Updated to ${newStatus}`
        });
        onStatusUpdate();
      } else {
        await showToast({
          style: Toast.Style.Failure,
          title: "Update Failed",
          message: "Could not update task status"
        });
      }
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Detail
      markdown={`# ${task.name}\n\n${content}`}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action title="Back to Tasks" icon={Icon.ArrowLeft} onAction={onBack} />
          </ActionPanel.Section>

          <ActionPanel.Section title="Update Status">
            <Action
              title="Mark as Revise"
              icon={Icon.ArrowClockwise}
              onAction={() => handleStatusChange("Revise")}
              isLoading={isUpdating}
            />
            <Action
              title="Mark as HUDL"
              icon={Icon.CircleFilled}
              onAction={() => handleStatusChange("HUDL")}
              isLoading={isUpdating}
            />
            <Action
              title="Mark as Dropbox"
              icon={Icon.Folder}
              onAction={() => handleStatusChange("Dropbox")}
              isLoading={isUpdating}
            />
            <Action
              title="Mark as Not Approved"
              icon={Icon.XMarkCircle}
              onAction={() => handleStatusChange("Not Approved")}
              isLoading={isUpdating}
            />
            <Action
              title="Mark as Uploads"
              icon={Icon.ArrowUp}
              onAction={() => handleStatusChange("Uploads")}
              isLoading={isUpdating}
            />
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action.OpenInBrowser
              title="Open in Notion"
              url={`https://www.notion.so/${task.id.replace(/-/g, "")}`}
              icon={Icon.ArrowNe}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

export default function ActiveTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { push, pop } = useNavigation();

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

  const filteredTasks = statusFilter === "all" 
    ? tasks 
    : tasks.filter(task => task.status === statusFilter);

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Active Video Tasks"
      searchBarPlaceholder="Search video tasks..."
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter by Status"
          value={statusFilter}
          onChange={setStatusFilter}
        >
          <List.Dropdown.Item title="All Statuses" value="all" />
          <List.Dropdown.Item title="Revise" value="Revise" />
          <List.Dropdown.Item title="HUDL" value="HUDL" />
          <List.Dropdown.Item title="Dropbox" value="Dropbox" />
          <List.Dropdown.Item title="Not Approved" value="Not Approved" />
          <List.Dropdown.Item title="Uploads" value="Uploads" />
        </List.Dropdown>
      }
    >
      <List.Section title="In Progress Tasks">
        {filteredTasks.map((task) => (
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
                <Action
                  title="View Page Content"
                  icon={Icon.Eye}
                  onAction={() => push(<PageContentView task={task} onBack={pop} onStatusUpdate={loadTasks} />)}
                  shortcut={{ modifiers: ["cmd"], key: "return" }}
                />
                <Action.OpenInBrowser
                  title="Open in Notion"
                  url={`https://www.notion.so/${task.id.replace(/-/g, "")}`}
                  icon={Icon.ArrowNe}
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
