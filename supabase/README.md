# Supabase Migrations

## Setup

This directory contains SQL migrations for the NPID inbox cache.

### Running Migrations

**Option 1: Supabase CLI (Recommended)**
```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Link to your project
supabase link --project-ref nmsynhztuelwxjlwezpn

# Apply migrations
supabase db push
```

**Option 2: Supabase Dashboard**
1. Go to https://supabase.com/dashboard/project/nmsynhztuelwxjlwezpn/editor
2. Copy contents of migration file
3. Run in SQL Editor

**Option 3: Direct psql**
```bash
psql "postgresql://postgres:[PASSWORD]@db.nmsynhztuelwxjlwezpn.supabase.co:5432/postgres" \
  -f supabase/migrations/001_create_npid_inbox_threads.sql
```

## Tables

### `npid_inbox_threads`
Cache of inbox threads scraped from NPID dashboard.

**Updated by:** Python scraper cron job (every 90 minutes)  
**Read by:** Raycast extension (instant reads)  
**Retention:** 7 days

**Key Columns:**
- `thread_id` - NPID message ID (unique)
- `can_assign` - Boolean for assignable vs assigned threads
- `status` - 'assigned' or 'unassigned'
- `scraped_at` - Last sync timestamp

**Indexes:**
- `thread_id` (unique lookups)
- `email` (contact searches)
- `status` (filter by assigned/unassigned)
- `can_assign` (filter assignable threads)
- `scraped_at` (freshness checks)

