# 🎬 Prospect Pipeline

**Student-athlete video editing workflow automation for Raycast**

A comprehensive Raycast extension that streamlines the video editing pipeline for student-athletes, integrating NPID (National Prospect ID), Notion, and for seamless task management and automation.

## ✨ Features

### 📋 **Active Video Tasks**
- Browse and filter Notion video tasks by status (Revise, HUDL, Dropbox, Not Approved, Uploads)
- Real-time task updates with due dates and player information
- Direct links to Notion pages and player profiles

### 📧 **Video Team Inbox Management**
- **Assign Inbox**: Automatically assign unassigned video team threads to team members
- **Read Inbox**: View and manage assigned video team messages
- Smart contact resolution and assignment defaults
- Attachment handling with direct download links

### 📨 **Email Automation**
- Send templated emails to student-athletes
- Pre-built templates for common scenarios (Editing Done, Video Instructions, etc.)
- Automated browser-based email sending

### 🎥 **Video Updates**
- Update athlete video profiles with YouTube links
- Automatic "Editing Done" email notifications
- Support for multiple seasons and video types

### 🔧 **Content Generation Tools**
- Standardized naming conventions for YouTube titles
- Dropbox folder naming with athlete details
- Approved video title formatting

## 🏗️ Architecture

### **Project Structure**

```
prospect-pipeline/
├── src/                          # Raycast Extension
│   ├── assign-videoteam-inbox.tsx # NPID inbox assignment
│   ├── read-videoteam-inbox.tsx  # Assigned message reader
│   ├── email-student-athletes.tsx # Email automation
│   ├── video-updates.tsx         # Video profile updates
│   ├── video-progress.tsx        # Video progress tracking
│   ├── lib/
│   │   ├── python-config.ts        # Centralized Python path configuration
│   │   ├── python-executor.ts      # Secure Python subprocess executor
│   │   ├── python-server-client.ts # NPID API client wrapper
│   │   └── npid-mcp-adapter.ts     # TypeScript helpers for NPID inbox/assignment flows
│   ├── python/
│   │   ├── npid_api_client.py    # NPID REST API (400-day sessions)
│   │   ├── npid_email_automator.py
│   │   └── npid_video_progress_sync.py
│   ├── tools/
│   │   ├── generate-content.ts   # Content generation
│   │   └── npid-inbox.ts         # NPID inbox tools
│   └── types/
│       ├── video-team.ts         # Video team types
│       └── workflow.ts           # Workflow types
├── web/                          # Next.js 15 Web Dashboard
│   └── src/app/                  # App Router pages
├── docs/                         # Documentation & specs
├── assets/                       # Images and static files
├── scripts/                      # Build & deployment scripts
└── supabase/                     # Database schema
```

### **Technology Stack**
- **Raycast Extension**: TypeScript, React
- **NPID Integration**: Python REST API (requests + BeautifulSoup)
- **Web Dashboard**: Next.js 15, React 19, Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Task Management**: Notion API



---

**Built by Jerami Singleton for Prospect ID Student Athlete*
