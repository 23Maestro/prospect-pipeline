# NPID Athlete Search MCP Server Design

**Date:** 2025-11-14
**Status:** Approved
**Scope:** TypeScript MCP server for athlete search with Raycast autocomplete integration

---

## Overview

Create a TypeScript MCP server that provides athlete search and detail retrieval from NPID Dashboard. Integrate with Raycast `generate-names` command to enable autocomplete athlete lookup and auto-fill form fields for content generation (YouTube titles, Dropbox folders, approved video titles).

---

## Architecture

### Server Structure

```
mcp-servers/npid-search/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # MCP server entry - registers tools
│   ├── npid-client.ts    # NPID API client (TS port of Python version)
│   ├── session.ts        # Cookie/remember-me session management
│   ├── season-calculator.ts  # Grade level / season name calculator
│   └── types.ts          # Type definitions
```

### Components

#### 1. MCP Server (`src/index.ts`)
- Registers two MCP tools: `search_athletes`, `get_athlete_details`
- Handles tool invocations and error responses
- Validates inputs before passing to NPID client

#### 2. NPID Client (`src/npid-client.ts`)
- Thin TypeScript port of `src/python/npid_api_client.py`
- Methods:
  - `login()`: Authenticate with NPID Dashboard
  - `validateSession()`: Check if current session is valid
  - `searchPlayer(query: string)`: Search for athletes
  - `getAthleteDetails(playerId: string)`: Get full athlete profile

#### 3. Session Manager (`src/session.ts`)
- Path: `~/.npid_session.json`
- Format:
  ```json
  {
    "cookies": "laravel_session=...; remember_web_...",
    "expiresAt": "2026-01-14T12:00:00.000Z"
  }
  ```
- Logic:
  - On each request: check `Date.now() > expiresAt`
  - If expired: force re-login, save new session
  - If valid: reuse cookies
- **Security**: Never log cookies, never write to stdout/stderr

#### 4. Season Calculator (`src/season-calculator.ts`)

Calculates current grade level and season name from graduation year.

**School year logic:**
- School year runs August 1 - May 31
- Graduation happens in May

```typescript
function calculateSeasonName(gradYear: number, currentDate: Date = new Date()): string {
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1; // 1-12

  // School year they're currently in
  let schoolYearEnd: number;
  if (currentMonth >= 8) {
    schoolYearEnd = currentYear + 1; // Nov 2025 → 2025-2026 school year → ends 2026
  } else {
    schoolYearEnd = currentYear; // May 2025 → 2024-2025 school year → ends 2025
  }

  // Years from now until they graduate
  const yearsUntilGrad = gradYear - schoolYearEnd;

  // Current grade level (12 = graduating this year, 11 = 1 year away, etc.)
  const gradeLevel = 12 - yearsUntilGrad;

  const seasonMap: Record<number, string> = {
    7: "7th Grade Season",
    8: "8th Grade Season",
    9: "Freshman Season",
    10: "Sophomore Season",
    11: "Junior Season",
    12: "Senior Season"
  };

  return seasonMap[gradeLevel] || "";
}
```

**Verified examples (Nov 14, 2025):**
- 2028 grad → "Sophomore Season"
- 2031 grad → "7th Grade Season"
- 2026 grad → "Senior Season"
- 2029 grad → "Freshman Season"

#### 5. Type Definitions (`src/types.ts`)

```typescript
interface AthleteSummary {
  id: string;          // playerId
  name: string;        // "First Last"
  gradYear: number;
  sport: "Football" | "Basketball" | "Baseball" | "Soccer" | "Volleyball" | "Softball";
  state: string;       // "IL"
}

interface AthleteDetails extends AthleteSummary {
  jerseyNumber?: string;
  positions?: string;      // Pipe-separated abbreviations from API: "QB-Dual | RB | WR"
  highSchool?: string;
  city?: string;
  seasonName?: string;     // Auto-calculated from gradYear
}
```

---

## Position Handling

**CRITICAL RULES:**

1. **API returns positions exactly as they appear** on video progress page
2. **Format**: Pipe-separated abbreviations: `"QB-Dual | RB | WR"`
3. **Never add placeholders**: If position 2 or 3 missing, leave blank (NOT "NA")
4. **Empty positions**: If API returns empty/blank, return empty string
5. **Never manufacture data**: Return exactly what API provides or empty string

**Position abbreviations** (from `/Users/singleton23/Documents/ProspectID/positions.md`):
- Football: QB-Dual, QB-Pro, RB, WR, TE, S, OLB, ILB, DE, DT, CB, ATH, etc.
- Basketball: PG, SG, SF, PF, C
- Baseball: RHP, LHP, SS, 3B, 2B, 1B, C, CF, LF, RF, DH
- Soccer: GK, CB, RB, LB, DM, CM, AM, RM, LM, RW, LW, F, ST, CF
- Volleyball: OH, OPP, MB, S, L, DS

---

## MCP Tool Contracts

### `search_athletes`

**Input:**
```json
{
  "query": "Sawyer Pellant"
}
```

**Output:**
```json
[
  {
    "id": "252287",
    "name": "Sawyer Pellant",
    "gradYear": 2028,
    "sport": "Soccer",
    "state": "AZ"
  }
]
```

### `get_athlete_details`

**Input:**
```json
{
  "id": "252287"
}
```

**Output:**
```json
{
  "id": "252287",
  "name": "Sawyer Pellant",
  "gradYear": 2028,
  "sport": "Soccer",
  "state": "AZ",
  "jerseyNumber": "12",
  "positions": "F | AM",
  "highSchool": "Hamilton High School",
  "city": "Chandler",
  "seasonName": "Sophomore Season"
}
```

**Note:** All fields except `id`, `name`, `gradYear`, `sport`, `state` are optional. Missing fields return `undefined`, never placeholder text.

---

## Raycast Integration

### Updates to `src/generate-names.tsx`

Add athlete search with autocomplete, auto-fill on selection, all fields remain editable.

---

## Content Generation Updates

### `src/tools/generate-content.ts`

```typescript
type Input = {
  athleteName: string;
  sport?: string;
  class?: string;
  positions?: string;        // Pipe-separated from API or manual
  highSchool?: string;
  city?: string;
  state?: string;
  jerseyNumber?: string;     // Manual input
  seasonName?: string;        // Auto-calculated, dropdown editable
  contentType: "youtube-title" | "dropbox-folder" | "google-drive-folder" | "approved-video-title";
};
```

#### DROPBOX_FILENAME
```
{FirstName}{LastName}_{GradYear}_{Sport}_{State}
Example: SawyerPellant_2028_Soccer_AZ
```

#### APPROVED_ID_TITLE
```
{FirstName} {LastName} #{JerseyNumber}    // Only if jerseyNumber provided
Class of {GradYear} - {Positions}         // Pipe-separated positions from API
{HighSchool}
{City}, {State}

Example:
Sawyer Pellant #12
Class of 2028 - F | AM
Hamilton High School
Chandler, AZ
```

#### YOUTUBE_TITLE
```
{FirstName} {LastName} Class of {GradYear} {SeasonName} Highlights

Example:
Sawyer Pellant Class of 2028 Sophomore Season Highlights
```

---

## Implementation Phases

### Phase 1: MCP Server Foundation
1. Initialize TypeScript project in `mcp-servers/npid-search/`
2. Implement session manager (`src/session.ts`)
3. Port NPID client basics (`src/npid-client.ts`): login, validateSession
4. Register MCP server in Claude Code config

### Phase 2: Season Calculator
1. Implement `calculateSeasonName()` in `src/season-calculator.ts`
2. Write unit tests for grade level calculation

### Phase 3: Search & Details Tools
1. Implement `searchPlayer()` method
2. Implement `getAthleteDetails()` method
3. Extract positions exactly as API provides (pipe-separated abbreviations)
4. Never add "NA" or placeholder text
5. Register both MCP tools

### Phase 4: Raycast Integration
1. Update `generate-names.tsx` with autocomplete search
2. Implement auto-fill on selection
3. All fields remain editable

### Phase 5: Content Generator Updates
1. Update `generate-content.ts` to handle new fields
2. Use positions exactly as provided (pipe-separated)

### Phase 6: Testing & Error Handling
1. Test with complete and incomplete athlete profiles
2. Verify empty positions remain empty (never "NA")
3. Ensure manual entry always works as fallback

---

## Success Criteria

1. Autocomplete search works in <1s
2. Auto-fill populates all available data
3. Positions returned exactly as API provides (pipe-separated abbreviations)
4. Empty positions remain empty (never "NA" or placeholders)
5. Missing data never blocks content generation
6. Manual entry always available as fallback
