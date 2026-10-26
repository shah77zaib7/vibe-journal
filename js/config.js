/* ============================================================================
   VibeJournal — cloud configuration
   ----------------------------------------------------------------------------
   Fill these in to enable Google Sign-In + Supabase cloud backup.

   Project URL  : Supabase dashboard → Project Settings → API → Project URL
   anon key     : Supabase dashboard → Project Settings → API → anon (public)
                  ^ the "anon / public" key, NOT the service_role key.
                    The service_role key bypasses Row Level Security and must
                    never be committed or shipped in the app.

   Leave them blank and the app stays 100% local — every feature still works,
   nothing is ever uploaded, and no Supabase code is even downloaded.
   ========================================================================== */
(function (global) {
  'use strict';

  var DEFAULTS = {
    supabaseUrl: 'https://jfmsetgnkvlnfqatsgyd.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmbXNldGdua3ZsbmZxYXRzZ3lkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5ODQ0ODEsImV4cCI6MjEwODU2MDQ4MX0.tHzWcRdtnFbnkFJkfPuK3tbJVZngM1YuY7eZWmBeOys',

    // Where Google sends the browser back to. Leave blank to use the
    // current page (correct for the PWA).
    oauthRedirectWeb: '',

    // Custom scheme handled by the Android app. Registered in
    // AndroidManifest.xml.
    oauthRedirectNative: 'vibejournal://auth-callback',

    // Private storage bucket for screenshots (see tools/supabase-schema.sql).
    shotsBucket: 'shots',

    // How often to push local changes while the app is open (ms).
    syncInterval: 60000
  };

  // Merge rather than replace — anything already set (a local override, a
  // test harness, a future build-time injection) wins over the defaults.
  global.VJConfig = Object.assign(DEFAULTS, global.VJConfig || {});
})(window);
