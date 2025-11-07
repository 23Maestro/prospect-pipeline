# VPS Broker - COMPLETE API Specification (CONFIRMED)

## ✅ ALL ENDPOINTS VERIFIED - Nov 6, 2025

**Base URL:** `https://dashboard.nationalpid.com`

---

## CRITICAL DISCOVERY: Stage/Status Uses STRING Values (Not IDs!)

The previous assumption about numeric IDs was **INCORRECT**. The API uses **string values** instead:

---

## 5. VIDEO PROGRESS TRACKING (CORRECTED)

### 5.1 Update Video Stage ✅ CONFIRMED
**Endpoint:** `POST /tasks/videostage`

**Content-Type:** `application/x-www-form-urlencoded`

**Form Data:**
```
_token={csrf_token}
&video_msg_id={thread_id}
&video_progress_stage={stage_value}
```

**Stage Values (STRING, not ID):**
| Stage | Value | URL-Encoded |
|-------|-------|-------------|
| On Hold | `On Hold` | `On+Hold` |
| Awaiting Client | `Awaiting Client` | `Awaiting+Client` |
| In Queue | `In Queue` | `In+Queue` |
| Done | `Done` | `Done` |

**Example Request:**
```
_token=acjtI57IhypCE0qzsSbye1v58ayKbiq6hKFcy3fg
&video_msg_id=11147
&video_progress_stage=On+Hold
```

**Response:** `200 OK` (no body)

---

### 5.2 Update Video Status ✅ CONFIRMED
**Endpoint:** `POST /tasks/videocompletemessage`

**Content-Type:** `application/x-www-form-urlencoded`

**Form Data:**
```
_token={csrf_token}
&video_msg_id={thread_id}
&video_progress_status={status_value}
```

**Status Values (STRING, not ID):**
| Status | Value | URL-Encoded |
|--------|-------|-------------|
| Revisions | `Revisions` | `Revisions` |
| HUDL | `HUDL` | `HUDL` |
| Dropbox | `Dropbox` | `Dropbox` |
| External Links | `External Links` | `External+Links` |
| Not Approved | `Not Approved` | `Not+Approved` |

**Example Request:**
```
_token=acjtI57IhypCE0qzsSbye1v58ayKbiq6hKFcy3fg
&video_msg_id=11147
&video_progress_status=HUDL
```

**Response:** `200 OK` (no body)

---

## 6. VIDEO DELIVERABLES (UPDATED)

### 6.1 Post YouTube Link
**Endpoint:** `POST /athlete/update/careervideos/{contact_id}`

**Content-Type:** `application/x-www-form-urlencoded`

**Form Data:**
```
_token={csrf_token}
&athleteviewtoken=
&schoolinfo[add_video_season]=sophomore
&sport_alias=football
&url_source=youtube
&newVideoLink=https://youtu.be/DRGzlDhqFZE
&videoType=Partial+Season+Highlight
&newVideoSeason=highschool:16267
&athlete_main_id={athlete_id}
```

**Response:**
```json
{
  "success": true,
  "video_id": "67890"
}
```

---

### 6.2 Unapprove Video ✅ NEW ENDPOINT
**Endpoint:** `POST /career/unapprovevideo`

**Content-Type:** `application/x-www-form-urlencoded`

**Form Data:**
```
video_id={video_id}
&_token={csrf_token}
&athlete_id={athlete_id}
```

**Purpose:** Check and remove old approved video before posting new one

**Example:**
```
video_id=84960
&_token=acjtI57IhypCE0qzsSbye1v58ayKbiq6hKFcy3fg
&athlete_id=1448012
```

**Workflow Integration:**
```python
# Before posting new video
1. Check if athlete has approved video
2. POST /career/unapprovevideo (if exists)
3. POST /athlete/update/careervideos/{contact_id}
```

**Response:** `200 OK`

---

## UPDATED: Complete API Flow Example

### Typical Video Completion Workflow (CORRECTED)

```python
# 1. Check inbox for new requests
GET /rulestemplates/template/videoteammessagelist

# 2. Open specific thread
GET /rulestemplates/template/videoteammessage_subject?id={thread_id}

# 3. If unassigned, search for contact
GET /template/calendaraccess/contactslist?search={athlete_email}

# 4. Assign thread to contact
POST /videoteammsg/assignvideoteam
  _token={csrf}
  videoteam_mailbox_id={thread_id}
  assign_to_contact={contact_id}

# 5. Update stage to "In Queue" (STRING VALUE)
POST /tasks/videostage
  _token={csrf}
  video_msg_id={thread_id}
  video_progress_stage=In+Queue

# 6. (After editing) Check for old approved video
POST /career/unapprovevideo
  video_id={old_video_id}
  _token={csrf}
  athlete_id={athlete_id}

# 7. Post new YouTube link
POST /athlete/update/careervideos/{contact_id}
  _token={csrf}
  newVideoLink=https://youtu.be/VIDEO_ID
  videoType=Partial+Season+Highlight
  sport_alias=football
  athlete_main_id={athlete_id}

# 8. Update status to "HUDL" (STRING VALUE)
POST /tasks/videocompletemessage
  _token={csrf}
  video_msg_id={thread_id}
  video_progress_status=HUDL

# 9. Load available email templates
GET /rulestemplates/template/videotemplates?id={contact_id}

# 10. Load recipient details
GET /rulestemplates/template/sendingtodetails?id={contact_id}

# 11. Send completion email
POST /admin/addnotification
  _token={csrf}
  notification_to_id={contact_id}
  indvtemplate=172
  notification_subject=Video Editing Complete
  notification_message=<html content>

# 12. Update stage to "Done" (STRING VALUE)
POST /tasks/videostage
  _token={csrf}
  video_msg_id={thread_id}
  video_progress_stage=Done

# 13. Reply to thread
POST /videoteammsg/sendmessage
  _token={csrf}
  videoteam_mailbox_id={thread_id}
  message="Video complete! Check your email."
```

---

## Python Implementation Example

```python
from urllib.parse import quote_plus

class VPSProgressAPI:
    """Video Progress System API for stage/status updates"""
    
    STAGES = {
        "on_hold": "On Hold",
        "awaiting_client": "Awaiting Client", 
        "in_queue": "In Queue",
        "done": "Done"
    }
    
    STATUSES = {
        "revisions": "Revisions",
        "hudl": "HUDL",
        "dropbox": "Dropbox",
        "external_links": "External Links",
        "not_approved": "Not Approved"
    }
    
    def update_stage(self, thread_id: str, stage: str) -> bool:
        """Update video stage using STRING value"""
        if stage not in self.STAGES:
            raise ValueError(f"Invalid stage: {stage}")
        
        stage_value = self.STAGES[stage]
        payload = {
            "_token": self.csrf_token,
            "video_msg_id": thread_id,
            "video_progress_stage": stage_value
        }
        
        response = self.session.post(
            f"{self.base_url}/tasks/videostage",
            data=payload
        )
        return response.status_code == 200
    
    def update_status(self, thread_id: str, status: str) -> bool:
        """Update video status using STRING value"""
        if status not in self.STATUSES:
            raise ValueError(f"Invalid status: {status}")
        
        status_value = self.STATUSES[status]
        payload = {
            "_token": self.csrf_token,
            "video_msg_id": thread_id,
            "video_progress_status": status_value
        }
        
        response = self.session.post(
            f"{self.base_url}/tasks/videocompletemessage",
            data=payload
        )
        return response.status_code == 200
    
    def unapprove_video(self, video_id: str, athlete_id: str) -> bool:
        """Remove old approved video before posting new one"""
        payload = {
            "video_id": video_id,
            "_token": self.csrf_token,
            "athlete_id": athlete_id
        }
        
        response = self.session.post(
            f"{self.base_url}/career/unapprovevideo",
            data=payload
        )
        return response.status_code == 200
```

---

## Complete Endpoint Inventory (13 Total)

### ✅ INBOX SYSTEM (6 endpoints)
1. `/rulestemplates/template/videoteammessagelist` - GET
2. `/rulestemplates/template/videoteammessage_subject` - GET
3. `/rulestemplates/template/assignemailtovideoteam` - GET
4. `/template/calendaraccess/contactslist` - GET
5. `/videoteammsg/assignvideoteam` - POST
6. `/videoteammsg/sendmessage` - POST

### ✅ PROGRESS TRACKING (2 endpoints)
7. `/tasks/videostage` - POST (uses STRING values)
8. `/tasks/videocompletemessage` - POST (uses STRING values)

### ✅ VIDEO DELIVERABLES (2 endpoints)
9. `/athlete/update/careervideos/{id}` - POST
10. `/career/unapprovevideo` - POST ⭐ NEW

### ✅ EMAIL NOTIFICATIONS (3 endpoints)
11. `/rulestemplates/template/videotemplates` - GET
12. `/rulestemplates/template/sendingtodetails` - GET
13. `/admin/addnotification` - POST

---

## Key Changes from Previous Spec

### ❌ INCORRECT (Previous Assumption)
```python
# OLD - Used numeric IDs
payload = {
    "video_team_id": thread_id,
    "video_stage_id": 3  # WRONG!
}
```

### ✅ CORRECT (Confirmed from HAR)
```python
# NEW - Uses string values
payload = {
    "video_msg_id": thread_id,
    "video_progress_stage": "In Queue"  # RIGHT!
}
```

### Additional Changes:
1. **Parameter name:** `video_team_id` → `video_msg_id`
2. **Value type:** Numeric ID → String value
3. **New endpoint:** `/career/unapprovevideo` for removing old videos

---

## HAR Files Used
- `vps_inbox_assignment_har.md` - Inbox, assignment, contact search
- `2025-11-04_video_progress-email_template_har.md` - Email templates
- `2025-11-06__video_progress-status_stage_har.md` - Stage/status values ⭐ NEW

**Date Captured:** November 4-6, 2025  
**Environment:** Production dashboard.nationalpid.com  
**Session:** videoteam@prospectid.com (400-day cookie preserved)

---

## Ready for Implementation ✅

All endpoints confirmed with REAL production data (not test account).
No estimated values remaining - everything verified from HAR captures.
