require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  // STEP 9: max edits per user per second (rate limit)
  maxEditsPerSecond: Math.max(1, parseInt(process.env.MAX_EDITS_PER_SECOND, 10) || 5),
  // STEP 10: auto-snapshot interval in minutes
  autoSnapshotIntervalMinutes: Math.max(1, parseInt(process.env.AUTO_SNAPSHOT_INTERVAL_MINUTES, 10) || 5),
  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
  email: {
    user: process.env.EMAIL_USER || '',
    password: process.env.EMAIL_PASSWORD || '',
  },
};
