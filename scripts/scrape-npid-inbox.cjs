#!/usr/bin/env node
/**
 * NPID Inbox Scraper - Standalone Script for n8n
 * Uses Playwright with 400-day saved session
 * Outputs JSON to stdout for n8n to parse
 * 
 * Usage: node scrape-npid-inbox.js
 * Output: {"html": "...", "scraped_at": "2025-10-05T..."}
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Path to saved Playwright state (400-day session)
const SAVED_STATE_PATH = '/Users/singleton23/Raycast/scout-singleton/state/playwright_state.json';
const NPID_INBOX_URL = 'https://dashboard.nationalpid.com/admin/videomailbox';

async function scrapeInbox() {
  let browser = null;
  
  try {
    // Load saved session state
    if (!fs.existsSync(SAVED_STATE_PATH)) {
      throw new Error(`Saved state not found at: ${SAVED_STATE_PATH}`);
    }
    
    const savedState = JSON.parse(fs.readFileSync(SAVED_STATE_PATH, 'utf8'));
    
    console.error('🎭 Launching Playwright with saved session...');
    
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
    
    // Get page HTML
    const html = await page.content();
    
    await browser.close();
    browser = null;
    
    console.error('✅ HTML extracted successfully');
    
    // Output JSON to stdout (n8n will parse this)
    const result = {
      html: html,
      scraped_at: new Date().toISOString(),
      success: true
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
      error: error.message,
      success: false,
      scraped_at: new Date().toISOString()
    };
    
    console.log(JSON.stringify(errorResult));
    process.exit(1);
  }
}

// Run the scraper
scrapeInbox();
