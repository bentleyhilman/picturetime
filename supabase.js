
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://oekquyqoeudemveqrueb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_lUEwNGyBtpyChs2kI1HJ0g_Rz2wwvAE";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
