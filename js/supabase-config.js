/* ============================================
   NUTRIX - Supabase Configuratie
   ============================================
   Vul hieronder de gegevens van je NutriX Supabase-project in.
   Te vinden in Supabase: Project Settings > API
*/

const SUPABASE_URL = 'VUL_PROJECT_URL_IN';        // bv. https://xxxxx.supabase.co
const SUPABASE_ANON_KEY = 'VUL_ANON_KEY_IN';      // de "anon public" key

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
