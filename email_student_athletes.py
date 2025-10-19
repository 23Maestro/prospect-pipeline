# /Users/singleton23/Raycast/prospect-pipeline/email_student_athletes.py
import asyncio
import os
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

VIDEO_PROGRESS_URL = "https://dashboard.nationalpid.com/videoteammsg/videomailprogress"
SEARCH_TEXT = "test test"
TIMEOUT = 10000  # ms

async def automate_email_send(page):
    LOGIN_URL = os.getenv("PP_LOGIN_URL")     # provided by Raycast extension secure env
    USERNAME = os.getenv("PP_USERNAME")       # provided by Raycast extension secure env
    PASSWORD = os.getenv("PP_PASSWORD")       # provided by Raycast extension secure env

    if LOGIN_URL and USERNAME and PASSWORD:
        await page.goto(LOGIN_URL, timeout=TIMEOUT)
        await page.fill("input[name='username']", USERNAME)
        await page.fill("input[name='password']", PASSWORD)
        await page.click("button[type='submit']")
        await page.wait_for_url("**/videoteammsg/**", timeout=TIMEOUT)
    else:
        await page.goto(VIDEO_PROGRESS_URL, timeout=TIMEOUT)

    await page.goto(VIDEO_PROGRESS_URL, timeout=TIMEOUT)

    search_box = page.get_by_role("textbox", name="Search", exact=True)
    await search_box.fill(SEARCH_TEXT)
    await search_box.press("Enter")

    await page.wait_for_timeout(1000)

    try:
        row = page.locator("text=Test Test").first
        await row.wait_for(state="visible", timeout=TIMEOUT)
        await row.locator("button:has-text('Email'), [aria-label='Email']").click()
    except PlaywrightTimeoutError:
        await page.locator('[ref="e2035"]').click()

    try:
        await page.locator('[ref="e2723"]').select_option(label="Editing Done: Video Editing Complete")
    except Exception:
        await page.locator('[ref="e2723"]').click()
        await page.get_by_text("Editing Done: Video Editing Complete").click()

    await page.locator('[ref="e2755"]').click()
    print("Email sent successfully!")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()
        try:
            await automate_email_send(page)
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
