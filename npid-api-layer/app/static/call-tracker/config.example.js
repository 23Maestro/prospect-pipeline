window.CALL_TRACKER_CONFIG = {
  supabaseUrl: 'https://PROJECT_REF.supabase.co',
  anonKey: 'SUPABASE_ANON_KEY',
  schema: 'public',
  // Local FastAPI: /api/v1/call-tracker/sync
  // Netlify proxy through Tailscale/Funnel: /api/call-tracker-sync
  syncEndpoint: '/api/v1/call-tracker/sync',
};
