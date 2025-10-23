import { createClient } from '@supabase/supabase-js';
import { getPreferenceValues } from '@raycast/api';

interface Preferences {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

function getSupabaseClient() {
  const { supabaseUrl, supabaseAnonKey } = getPreferenceValues<Preferences>();

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
    },
  });
}

export const supabase = getSupabaseClient();
