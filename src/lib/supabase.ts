import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://xkslyzdmynpmzllxyslj.supabase.co'
const supabasePublishableKey = 'sb_publishable_bMvLYrrT8L0bpVnnw-A4gQ_OVzfvmZJ'

export const syncEnabled = true

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
