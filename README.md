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

### **Core Components**

```
src/
├── active-tasks.tsx              # Notion task browser
├── assign-videoteam-inbox.tsx    # NPID inbox assignment
├── read-videoteam-inbox.tsx      # Assigned message reader
├── email-student-athletes.tsx    # Email automation
├── video-updates.tsx             # Video profile updates
├── bridge/
│   └── mcpClient.ts              # MCP Gateway integration
├── lib/
│   ├── npid-mcp-adapter.ts       # NPID API adapter
│   └── npid-mcp.ts               # NPID MCP client
├── tools/
│   ├── generate-content.ts       # Content generation
│   ├── npid-inbox.ts             # NPID inbox tools
│   └── reconnect.ts              # Session management
└── types/
    ├── video-team.ts             # Video team types
    └── workflow.ts               # Workflow types
```

### **MCP Servers**
- **NPID Native**: Python-based NPID dashboard automation
- **Notion Bridge**: Notion API integration
- **Video Team Bridge**: Video team workflow automation



---

**Built  by Jerami Singleton for Propsect Id Student Athlete*
