# Product Overview

## What is Prospect Pipeline?

Prospect Pipeline is a comprehensive Raycast extension that streamlines the video editing workflow for student-athlete recruiting. It automates the coordination between video editors, student-athletes, and the NPID (National Prospect ID) platform, eliminating manual data entry and reducing communication overhead.

## Core Features

### 📋 Active Video Tasks
- Browse and filter Notion video tasks by status (Revise, HUDL, Dropbox, Not Approved, Uploads)
- Real-time task updates with due dates and player information
- Direct links to Notion pages and player profiles
- Integration with Notion's video task database

### 📧 Video Team Inbox Management
- **Assign Inbox**: Automatically assign unassigned video team threads to team members
- **Read Inbox**: View and manage assigned video team messages
- Smart contact resolution with automatic athlete/parent detection
- Attachment handling with direct download links
- Bulk assignment workflows with default stage/status recommendations

### 📨 Email Automation
- Send templated emails to student-athletes
- Pre-built templates for common scenarios:
  - "Editing Done" - Video completion notification
  - "Video Instructions" - Initial contact and requirements
  - Custom templates via NPID email system
- Automated browser-based email sending

### 🎥 Video Updates
- Update athlete video profiles with YouTube links
- Automatic 3-step workflow:
  1. Upload video to NPID profile
  2. Send "Editing Done" email to athlete
  3. Update stage to "Done" in video progress tracker
- Support for multiple seasons and video types (Full Season, Partial Season, Single Game, Skills/Training)
- Automatic season detection based on athlete data

### 🔧 Content Generation Tools
- Standardized naming conventions for YouTube titles
- Dropbox folder naming with athlete details
- Approved video title formatting
- Consistent metadata across platforms

## Target Use Case

**Primary Users**: Video editing teams managing student-athlete recruiting content for NPID

**Key Workflow**:
1. Receive video editing requests via NPID inbox
2. Assign requests to video editors with proper stage/status tracking
3. Track progress through Notion task board
4. Upload completed videos and notify athletes
5. Monitor active tasks and deadlines

**Pain Points Solved**:
- Manual copying of athlete names, emails, and details between systems
- Inconsistent email communication with athletes
- Lost or delayed video editing requests in inbox
- Time-consuming status updates across multiple platforms
- Lack of visibility into video progress pipeline

## Key Value Proposition

### Speed
- **5-second video updates**: Upload video + send email + update stage in one command
- **Instant inbox assignment**: Assign messages with smart contact detection
- **Quick task overview**: See all active video tasks at a glance

### Accuracy
- **Eliminates copy-paste errors**: Direct integration with NPID and Notion
- **Smart contact resolution**: Automatically distinguishes athlete vs parent messages
- **Consistent naming**: Standardized formats across all platforms

### Visibility
- **Real-time task tracking**: Notion integration shows current workload
- **Attachment previews**: See HUDL links and video files directly in inbox
- **Due date monitoring**: Visual indicators for urgent tasks

### Integration
- **Native Raycast experience**: Fast, keyboard-driven interface
- **NPID REST API**: Direct communication with NPID platform
- **Notion API**: Bidirectional sync with task database
- **Supabase**: Centralized configuration and data storage

## Unique Differentiators

1. **Raycast-First Design**: Built specifically for keyboard-driven productivity workflows
2. **Automated 3-Step Process**: Video upload triggers email and stage update automatically
3. **Smart Contact Detection**: Automatic fallback from athlete to parent search
4. **Session Persistence**: 400-day NPID session cookies eliminate re-login friction
5. **Dual Search Modes**: Search by athlete name or direct Player ID entry

## Success Metrics

- **Time saved per video update**: ~90 seconds (from 120s manual to 30s automated)
- **Assignment accuracy**: 100% with smart contact fallback
- **Email delivery rate**: Tracked via NPID email system
- **Task visibility**: Real-time sync with Notion board

## Future Roadmap

Potential enhancements (not yet implemented):
- Bulk video uploads for multiple athletes
- Advanced search and filtering in inbox
- Custom email template creation within Raycast
- Video progress analytics and reporting
- Direct HUDL integration for source footage
