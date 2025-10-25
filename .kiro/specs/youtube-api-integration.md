# YouTube API Integration Specification
**Phase 2 - Post-Ship**
**Status**: Implementation Ready

---

## OVERVIEW

Auto-upload exported videos to prospect ID YouTube channel via Hazel folder monitoring. Store YouTube URL for use in `video-updates` command.

---

## BUSINESS CONTEXT

### Current State
- Videos exported from Premiere Pro to: `/Volumes/MediaSSD/CreativeCloud/Premiere/FinishedCuts/ProspectID/` (with nested sport folders)
- Manual upload to prospect ID YouTube channel required
- No automated workflow

### Desired State
- **Hazel watches** folder and triggers upload script on new files
- **Auto-uploads** to prospect ID YouTube channel
- **Support nested sport folders** (Football, Basketball, etc.)
- **Clean up** after upload (delete or move file)

### Timeline
- **Phase 1** (Ship by 10/27): Contact search, Reply, Caching
- **Phase 2** (Target ~11/15): YouTube API integration

---

## REQUIREMENTS

### Functional Requirements

**FR1: Video Upload to YouTube**
- Detect exported videos in `/Volumes/MediaSSD/CreativeCloud/Premiere/FinishedCuts/ProspectID/` and subfolders
- Upload to prospect ID YouTube channel
- Support video formats: MP4, MOV, AVI, WMV

**FR2: Folder Monitoring**
- Hazel watches parent folder (handles nested sport folders automatically)
- Triggers upload script on new file detection
- Extract sport from folder path and filename

**FR3: File Cleanup**
- Delete or move uploaded files after successful upload

---

## IMPLEMENTATION PLAN

### Step 1: Google Cloud Setup
- Create YouTube project in Google Cloud Console
- Enable YouTube Data API v3
- Create service account or OAuth credentials
- Obtain API key/credentials file
- Store securely in environment variables

### Step 2: Hazel Rule
- Watch folder: `/Volumes/MediaSSD/CreativeCloud/Premiere/FinishedCuts/ProspectID/`
- Match: Video files (MP4, MOV, AVI, WMV)
- Action: Run Automator workflow or shell script with `$FILEPATH`

### Step 3: Upload Script
- Input: Full filepath from Hazel
- Parse: Extract sport from folder path, athlete/type from filename
- Upload: Send video to YouTube API
- Cleanup: Delete/move file after success
- Error handling: Log failures, no retry needed (Hazel can trigger again)

### Step 4: Testing
- Test with sample video in each sport folder
- Verify upload appears on prospect ID channel
- Verify file cleanup works
- Test error cases (network, invalid file)

---

## DECISIONS

- **Monitoring**: Hazel + script (Automator or shell)
- **Authentication**: Service account (simpler, no user auth)
- **Cleanup**: Delete after upload
- **Nested folders**: Parse sport from path structure

---

## NEXT STEPS

1. Set up Google Cloud project & get credentials
2. Choose: Automator workflow or shell script
3. Build upload script
4. Create Hazel rule
5. Test end-to-end
