-- NPID Inbox Threads Cache Table
-- Purpose: Store scraped inbox threads for fast Raycast reads
-- Updated by: Python scraper cron job every 90 minutes

CREATE TABLE IF NOT EXISTS npid_inbox_threads (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- NPID identifiers (from scraper)
  thread_id TEXT UNIQUE NOT NULL,  -- e.g. "message_id12471"
  itemcode TEXT,                    -- NPID internal code
  
  -- Contact info
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  
  -- Message content
  subject TEXT NOT NULL,
  preview TEXT,                     -- Cleaned preview (no reply chains)
  
  -- Assignment status
  status TEXT NOT NULL,             -- 'assigned' or 'unassigned'
  can_assign BOOLEAN NOT NULL DEFAULT false,
  
  -- Timestamps
  timestamp TEXT,                   -- Display timestamp from NPID (e.g. "Tue, Oct 7")
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_npid_inbox_threads_thread_id ON npid_inbox_threads(thread_id);
CREATE INDEX IF NOT EXISTS idx_npid_inbox_threads_email ON npid_inbox_threads(email);
CREATE INDEX IF NOT EXISTS idx_npid_inbox_threads_status ON npid_inbox_threads(status);
CREATE INDEX IF NOT EXISTS idx_npid_inbox_threads_can_assign ON npid_inbox_threads(can_assign);
CREATE INDEX IF NOT EXISTS idx_npid_inbox_threads_scraped_at ON npid_inbox_threads(scraped_at DESC);

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_npid_inbox_threads_updated_at 
  BEFORE UPDATE ON npid_inbox_threads 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies (public read access for anon key)
ALTER TABLE npid_inbox_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" 
  ON npid_inbox_threads 
  FOR SELECT 
  USING (true);

-- Auto-cleanup old threads (keep last 7 days)
-- Note: This will be handled by a separate cleanup job or manual maintenance
-- For now, just document the retention policy

COMMENT ON TABLE npid_inbox_threads IS 
  'Cache of NPID inbox threads. Updated every 90 minutes by Python scraper. Retention: 7 days.';

