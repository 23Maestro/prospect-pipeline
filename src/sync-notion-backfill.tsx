import React, { useState } from 'react';
import { Action, ActionPanel, Form, Toast, showToast, getPreferenceValues } from '@raycast/api';
import { useForm } from '@raycast/utils';
import { Client } from '@notionhq/client';
import { callVPSBroker } from './lib/vps-broker-adapter';

interface SyncFormValues {
  fromDate: string;
  toDate: string;
}

interface VideoProgressRecord {
  athlete_id: number;
  athletename: string;
  primaryposition: string;
  secondaryposition: string;
  thirdposition: string;
  high_school: string;
  high_school_city: string;
  high_school_state: string;
  sport_name: string;
  grad_year: number;
  paid_status: string;
  assignedvideoeditor: string;
  assigned_date: string;
  stage: string;
  video_progress_status: string;
  [key: string]: any;
}

function getNotion() {
  const { notionToken } = getPreferenceValues<{ notionToken: string }>();
  return new Client({ auth: notionToken });
}

async function fetchVideoProgressByDateRange(fromDate: string, toDate: string): Promise<VideoProgressRecord[]> {
  try {
    // Fetch all video progress (no filters initially, we'll filter by date in JS)
    const allRecords = await callVPSBroker<VideoProgressRecord[]>('get_video_progress', {
      filters: {}
    });

    if (!allRecords || !Array.isArray(allRecords)) {
      return [];
    }

    // Filter by assigned_date within range
    const from = new Date(fromDate).getTime();
    const to = new Date(toDate).getTime();

    return allRecords.filter((record) => {
      if (!record.assigned_date) return false;
      const recordDate = new Date(record.assigned_date).getTime();
      return recordDate >= from && recordDate <= to;
    });
  } catch (error) {
    console.error('Failed to fetch video progress:', error);
    return [];
  }
}

async function findNotionPageByAthleteName(athleteName: string, databaseId: string) {
  const notion = getNotion();
  try {
    // Query all pages and filter in JS (more reliable than Notion filter)
    const response = await notion.databases.query({
      database_id: databaseId,
      page_size: 100
    });

    // Find matching page by name
    const match = response.results.find((page: any) => {
      const name = page.properties?.Name?.title?.[0]?.plain_text || '';
      return name.toLowerCase() === athleteName.toLowerCase();
    });

    return match || null;
  } catch (error) {
    console.error(`Failed to query Notion for ${athleteName}:`, error);
    return null;
  }
}

async function updateNotionPage(pageId: string, videoData: VideoProgressRecord) {
  const notion = getNotion();
  try {
    // Build properties object - preserve Due Date, update everything else
    const properties: Record<string, any> = {
      Name: { title: [{ text: { content: videoData.athletename } }] },
      'Athlete ID': { rich_text: [{ text: { content: String(videoData.athlete_id) } }] },
      'Primary Position': { rich_text: [{ text: { content: videoData.primaryposition || 'NA' } }] },
      'Secondary Position': { rich_text: [{ text: { content: videoData.secondaryposition || 'NA' } }] },
      'Third Position': { rich_text: [{ text: { content: videoData.thirdposition || 'NA' } }] },
      'Video Progress': { status: { name: videoData.video_progress || 'In Progress' } },
      Stage: { status: { name: videoData.stage || 'In Queue' } },
      Status: { status: { name: videoData.video_progress_status || 'HUDL' } },
      'Assigned Date': { rich_text: [{ text: { content: videoData.assigned_date || 'N/A' } }] },
      Sport: { rich_text: [{ text: { content: videoData.sport_name || 'N/A' } }] },
      School: { rich_text: [{ text: { content: videoData.high_school || 'N/A' } }] },
      City: { rich_text: [{ text: { content: videoData.high_school_city || 'N/A' } }] },
      State: { rich_text: [{ text: { content: videoData.high_school_state || 'N/A' } }] },
      'Grad Year': { rich_text: [{ text: { content: String(videoData.grad_year || 'N/A') } }] },
      'Payment Status': { rich_text: [{ text: { content: videoData.paid_status || 'N/A' } }] },
      'Video Editor': { rich_text: [{ text: { content: videoData.assignedvideoeditor || 'N/A' } }] },
    };

    await notion.pages.update({
      page_id: pageId,
      properties
    });

    return true;
  } catch (error) {
    console.error(`Failed to update Notion page ${pageId}:`, error);
    return false;
  }
}

async function createNotionPage(videoData: VideoProgressRecord, databaseId: string) {
  const notion = getNotion();
  try {
    const properties: Record<string, any> = {
      Name: { title: [{ text: { content: videoData.athletename } }] },
      'Athlete ID': { rich_text: [{ text: { content: String(videoData.athlete_id) } }] },
      'Primary Position': { rich_text: [{ text: { content: videoData.primaryposition || 'NA' } }] },
      'Secondary Position': { rich_text: [{ text: { content: videoData.secondaryposition || 'NA' } }] },
      'Third Position': { rich_text: [{ text: { content: videoData.thirdposition || 'NA' } }] },
      'Video Progress': { status: { name: videoData.video_progress || 'In Progress' } },
      Stage: { status: { name: videoData.stage || 'In Queue' } },
      Status: { status: { name: videoData.video_progress_status || 'HUDL' } },
      'Assigned Date': { rich_text: [{ text: { content: videoData.assigned_date || 'N/A' } }] },
      Sport: { rich_text: [{ text: { content: videoData.sport_name || 'N/A' } }] },
      School: { rich_text: [{ text: { content: videoData.high_school || 'N/A' } }] },
      City: { rich_text: [{ text: { content: videoData.high_school_city || 'N/A' } }] },
      State: { rich_text: [{ text: { content: videoData.high_school_state || 'N/A' } }] },
      'Grad Year': { rich_text: [{ text: { content: String(videoData.grad_year || 'N/A') } }] },
      'Payment Status': { rich_text: [{ text: { content: videoData.paid_status || 'N/A' } }] },
      'Video Editor': { rich_text: [{ text: { content: videoData.assignedvideoeditor || 'N/A' } }] },
    };

    await notion.pages.create({
      parent: { database_id: databaseId },
      properties
    });

    return true;
  } catch (error) {
    console.error(`Failed to create Notion page for ${videoData.athletename}:`, error);
    return false;
  }
}

export default function SyncNotionBackfillCommand() {
  const { handleSubmit, itemProps } = useForm<SyncFormValues>({
    async onSubmit(formValues) {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: 'Starting sync...',
        message: 'Fetching video progress records...'
      });

      try {
        // Fetch video progress records within date range
        const videoRecords = await fetchVideoProgressByDateRange(formValues.fromDate, formValues.toDate);

        if (videoRecords.length === 0) {
          toast.style = Toast.Style.Failure;
          toast.title = 'No records found';
          toast.message = `No video progress records between ${formValues.fromDate} and ${formValues.toDate}`;
          return;
        }

        const databaseId = '19f4c8bd6c26805b9929dfa8eb290a86';
        let synced = 0;
        let skipped = 0;
        let failed = 0;

        toast.title = `Processing ${videoRecords.length} records...`;

        for (let i = 0; i < videoRecords.length; i++) {
          const record = videoRecords[i];
          toast.message = `${i + 1}/${videoRecords.length}: ${record.athletename}`;

          try {
            console.log(`[${i + 1}/${videoRecords.length}] Processing: ${record.athletename}`);

            // Find existing Notion page
            const existingPage = await findNotionPageByAthleteName(record.athletename, databaseId);

            if (existingPage) {
              console.log(`  ✓ Found existing page for ${record.athletename}`);
              // Update existing page
              const success = await updateNotionPage(existingPage.id, record);
              if (success) {
                console.log(`  ✅ Updated ${record.athletename}`);
                synced++;
              } else {
                console.log(`  ❌ Failed to update ${record.athletename}`);
                failed++;
              }
            } else {
              console.log(`  ✓ No existing page, creating new for ${record.athletename}`);
              // Create new page
              const success = await createNotionPage(record, databaseId);
              if (success) {
                console.log(`  ✅ Created ${record.athletename}`);
                synced++;
              } else {
                console.log(`  ❌ Failed to create ${record.athletename}`);
                failed++;
              }
            }
          } catch (error) {
            console.error(`❌ Error processing ${record.athletename}:`, error);
            failed++;
          }
        }

        toast.style = Toast.Style.Success;
        toast.title = '✅ Sync Complete!';
        toast.message = `Synced: ${synced} | Failed: ${failed}`;
      } catch (error) {
        console.error('Sync error:', error);
        toast.style = Toast.Style.Failure;
        toast.title = 'Sync Failed';
        toast.message = error instanceof Error ? error.message : 'Unknown error occurred';
      }
    },
    initialValues: {
      fromDate: '2025-06-01',
      toDate: new Date().toISOString().split('T')[0], // Today's date
    }
  });

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Start Backfill Sync" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text="Sync video progress records to Notion within a date range. Preserves your Notion due dates." />
      <Form.Separator />

      <Form.DatePicker
        id="fromDate"
        title="From Date"
        {...itemProps.fromDate}
      />

      <Form.DatePicker
        id="toDate"
        title="To Date"
        {...itemProps.toDate}
      />

      <Form.Description text="⚠️ This will update existing Notion records and create new ones for any missing athletes. Your manually set due dates will be preserved." />
    </Form>
  );
}
