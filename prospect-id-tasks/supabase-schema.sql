-- Prospect Pipeline Kanban Database Schema
-- Run this in Supabase SQL Editor

-- Enable pgvector for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Athletes table
CREATE TABLE IF NOT EXISTS athletes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  grad_year INT,
  sport TEXT,
  high_school TEXT,
  city TEXT,
  state TEXT,
  player_id TEXT UNIQUE, -- NPID player ID
  email TEXT,
  phone TEXT,
  tags TEXT[],
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tasks table with actual status values from your system
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID REFERENCES athletes(id) ON DELETE CASCADE,

  -- Source of the task
  source TEXT CHECK (source IN ('HUDL','Dropbox','YouTube','Inbox')) NOT NULL,

  -- Status column - ACTUAL values from your system
  status TEXT CHECK (status IN ('HUDL','Dropbox','Not Approved','Revise','Done','Upload')) NOT NULL,

  -- Task details
  title TEXT NOT NULL,
  body TEXT,
  due_date DATE,
  season INT,
  sport TEXT,
  positions TEXT[],

  -- Video information
  youtube_link TEXT,
  video_type TEXT,

  -- Metadata
  assigned_to TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Vector embedding for semantic search
  embedding vector(1536)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks(due_date);
CREATE INDEX IF NOT EXISTS tasks_athlete_idx ON tasks(athlete_id);
CREATE INDEX IF NOT EXISTS tasks_sport_idx ON tasks(sport);
CREATE INDEX IF NOT EXISTS tasks_embedding_ivf ON tasks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS athletes_player_id_idx ON athletes(player_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_athletes_updated_at BEFORE UPDATE ON athletes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Webhook trigger for status changes to "Done"
CREATE OR REPLACE FUNCTION notify_task_done()
RETURNS TRIGGER AS $$
DECLARE
  athlete_name TEXT;
BEGIN
  -- Only fire when status changes to 'Done'
  IF NEW.status = 'Done' AND (OLD.status IS NULL OR OLD.status != 'Done') THEN

    -- Get athlete name
    SELECT name INTO athlete_name
    FROM athletes
    WHERE id = NEW.athlete_id;

    -- Log the event (you can replace this with actual webhook call)
    RAISE NOTICE 'Task % completed for athlete %', NEW.title, athlete_name;

    -- TODO: Call external webhook endpoint here
    -- For now, we'll handle this in the Next.js API route

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_status_done_trigger
  AFTER UPDATE OF status ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_done();

-- Row Level Security (optional - enable if you want multi-user)
-- ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE athletes ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all operations for now
-- CREATE POLICY "Allow all operations" ON tasks FOR ALL USING (true);
-- CREATE POLICY "Allow all operations" ON athletes FOR ALL USING (true);

-- Sample data for testing
INSERT INTO athletes (name, grad_year, sport, high_school, city, state, player_id, email) VALUES
  ('John Smith', 2025, 'Football', 'Central High', 'Dallas', 'TX', 'NPID-12345', 'john.smith@example.com'),
  ('Sarah Johnson', 2026, 'Basketball', 'North High', 'Houston', 'TX', 'NPID-67890', 'sarah.j@example.com')
ON CONFLICT (player_id) DO NOTHING;

-- Sample tasks
INSERT INTO tasks (athlete_id, source, status, title, body, due_date, sport, season) VALUES
  (
    (SELECT id FROM athletes WHERE player_id = 'NPID-12345'),
    'HUDL',
    'HUDL',
    'Season Highlight Reel',
    'Create full season highlight reel from HUDL footage',
    CURRENT_DATE + INTERVAL '7 days',
    'Football',
    2024
  ),
  (
    (SELECT id FROM athletes WHERE player_id = 'NPID-67890'),
    'Dropbox',
    'Revise',
    'Game Film Edit',
    'Revise opening sequence timing',
    CURRENT_DATE + INTERVAL '3 days',
    'Basketball',
    2024
  )
ON CONFLICT DO NOTHING;
