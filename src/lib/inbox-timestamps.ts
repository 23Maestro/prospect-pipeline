import { NPIDInboxMessage } from "../types/video-team";
import { fetchMessageDetail } from "./npid-mcp-adapter";

const DATE_REGEX = /\d{4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun/i;
const TIME_REGEX = /\d{1,2}:\d{2}\s*(AM|PM)/i;

export function shouldHydrateTimestamp(rawValue?: string | null): boolean {
  if (!rawValue) {
    return true;
  }
  const hasDate = DATE_REGEX.test(rawValue);
  const hasTime = TIME_REGEX.test(rawValue);
  return !(hasDate && hasTime);
}

export async function hydrateThreadTimestamps(
  messages: NPIDInboxMessage[],
  batchSize = 5
): Promise<NPIDInboxMessage[]> {
  const toHydrate = messages.filter(
    (msg) => shouldHydrateTimestamp(msg.timeStampDisplay) || shouldHydrateTimestamp(msg.timestamp)
  );

  if (toHydrate.length === 0) {
    return messages;
  }

  const updates = new Map<string, string>();

  for (let i = 0; i < toHydrate.length; i += batchSize) {
    const batch = toHydrate.slice(i, i + batchSize);
    const details = await Promise.all(
      batch.map(async (msg) => {
        try {
          const result = await fetchMessageDetail(msg.id, msg.itemCode || msg.id);
          return { id: msg.id, timestamp: result.timestamp || result.time_stamp };
        } catch (error) {
          console.error("Failed to hydrate timestamp", error);
          return null;
        }
      })
    );

    details.forEach((detail) => {
      if (detail?.timestamp) {
        updates.set(detail.id, detail.timestamp);
      }
    });
  }

  if (updates.size === 0) {
    return messages;
  }

  return messages.map((message) => {
    const update = updates.get(message.id);
    if (!update) {
      return message;
    }

    return {
      ...message,
      timestamp: update,
      timeStampDisplay: update,
    } as NPIDInboxMessage;
  });
}
