#!/usr/bin/env node
/* eslint-env node */
/**
 * NPID Thread Assignment - Standalone Script for n8n
 * Uses Playwright with 400-day saved session
 * Assigns a thread to a video team member
 * 
 * Usage: node assign-npid-thread.js '{"thread_id":"message_id12403","owner":"user@example.com","contact":"athlete@example.com","stage":"In Queue","status":"HUDL"}'
 * Output: {"success": true, "assigned_at": "2025-10-05T..."}
 */

const { chromium } = require('playwright');
const fs = require('fs');

// Path to saved Playwright state (400-day session)
const SAVED_STATE_PATH = '/Users/singleton23/Raycast/scout-singleton/state/playwright_state.json';
const NPID_INBOX_URL = 'https://dashboard.nationalpid.com/admin/videomailbox';

async function assignThread(payload) {
  let browser = null;
  
  try {
    // Validate payload
    if (!payload.thread_id || !payload.owner) {
      throw new Error('Missing required fields: thread_id and owner');
    }
    
    // Load saved session state
    if (!fs.existsSync(SAVED_STATE_PATH)) {
      throw new Error(`Saved state not found at: ${SAVED_STATE_PATH}`);
    }
    
    const savedState = JSON.parse(fs.readFileSync(SAVED_STATE_PATH, 'utf8'));
    
    console.error('🎭 Launching Playwright for assignment...');
    
    // Launch browser
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const context = await browser.newContext();
    
    // Load saved cookies
    if (savedState.cookies && savedState.cookies.length > 0) {
      await context.addCookies(savedState.cookies);
      console.error(`✅ Loaded ${savedState.cookies.length} cookies`);
    }
    
    const page = await context.newPage();
    
    console.error('📧 Navigating to NPID inbox...');
    await page.goto(NPID_INBOX_URL, { 
      waitUntil: 'networkidle', 
      timeout: 30000 
    });
    
    // Check if we're logged in
    const isLoggedIn = await page.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      return !bodyText.includes('login') && !bodyText.includes('sign in');
    });
    
    if (!isLoggedIn) {
      throw new Error('Session expired - not logged in');
    }
    
    console.error('✅ Logged in successfully');
    console.error(`🎯 Assigning thread ${payload.thread_id} to ${payload.owner}...`);
    
    // Find the thread element
    const threadSelector = `#${payload.thread_id}`;
    const threadExists = await page.locator(threadSelector).count() > 0;
    
    if (!threadExists) {
      throw new Error(`Thread not found: ${payload.thread_id}`);
    }
    
    // Click the assign button (adjust selector based on actual NPID UI)
    const assignButtonSelector = `${threadSelector} button[id*="assignvideoteam"], ${threadSelector} .assign-btn`;
    await page.locator(assignButtonSelector).first().click();
    
    // Wait for assignment modal/form
    await page.waitForTimeout(1000);
    
    // Fill in assignment details (adjust selectors based on actual NPID UI)
    // Owner/Assignee
    const ownerSelector = 'select[name="owner"], select[id*="owner"], input[name="owner"]';
    await page.locator(ownerSelector).first().fill(payload.owner);
    
    // Contact (optional)
    if (payload.contact) {
      const contactSelector = 'select[name="contact"], input[name="contact"]';
      const contactExists = await page.locator(contactSelector).count() > 0;
      if (contactExists) {
        await page.locator(contactSelector).first().fill(payload.contact);
      }
    }
    
    // Stage (optional)
    if (payload.stage) {
      const stageSelector = 'select[name="stage"], input[name="stage"]';
      const stageExists = await page.locator(stageSelector).count() > 0;
      if (stageExists) {
        await page.locator(stageSelector).first().fill(payload.stage);
      }
    }
    
    // Status (optional)
    if (payload.status) {
      const statusSelector = 'select[name="status"], input[name="status"]';
      const statusExists = await page.locator(statusSelector).count() > 0;
      if (statusExists) {
        await page.locator(statusSelector).first().fill(payload.status);
      }
    }
    
    // Submit the assignment
    const submitSelector = 'button[type="submit"], button:has-text("Assign"), button:has-text("Submit")';
    await page.locator(submitSelector).first().click();
    
    // Wait for success confirmation
    await page.waitForTimeout(2000);
    
    await browser.close();
    browser = null;
    
    console.error('✅ Thread assigned successfully');
    
    // Output success JSON to stdout
    const result = {
      success: true,
      thread_id: payload.thread_id,
      owner: payload.owner,
      assigned_at: new Date().toISOString()
    };
    
    console.log(JSON.stringify(result));
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (browser) {
      await browser.close();
    }
    
    // Output error JSON
    const errorResult = {
      success: false,
      error: error.message,
      thread_id: payload?.thread_id || 'unknown',
      assigned_at: new Date().toISOString()
    };
    
    console.log(JSON.stringify(errorResult));
    process.exit(1);
  }
}

// Parse arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node assign-npid-thread.js \'{"thread_id":"...","owner":"..."}\'');
  process.exit(1);
}

try {
  const payload = JSON.parse(args[0]);
  assignThread(payload);
} catch (error) {
  console.error('❌ Invalid JSON payload:', error.message);
  process.exit(1);
}
