// ============================================================
// SUPABASE PRIPOJENIE
// Vlož sem svoje údaje z Supabase projektu (Settings -> API)
// ============================================================
const SUPABASE_URL = 'https://qrxnepwmnelunzpjezhx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JLM9z0ruBd7WTPV89Xbj1w_7Tw68pw4';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
