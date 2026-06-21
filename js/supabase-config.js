/* ============================================
   BRIGHTLY - Supabase Configuratie
   ============================================
   Vul hieronder de gegevens van je Brightly Supabase-project in.
   Te vinden in Supabase: Project Settings > API
*/

const SUPABASE_URL = 'https://rjxlegqwsegkvqqwmryr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqeGxlZ3F3c2Vna3ZxcXdtcnlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNTQ1MDcsImV4cCI6MjA5NzYzMDUwN30.2KROZ40Vc4Iot40SbdSQvrVm_U1uyKeHBXdlopjVp-s';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
