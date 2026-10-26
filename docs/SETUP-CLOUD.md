# Connecting VibeJournal to Supabase (step by step)

This walks you through the last two steps — turning on Google sign-in and
adding your keys. It should take about 10 minutes.

You do this **once**, on your computer. After that the app just works.

---

## Before you start

You need these open in three tabs:

| Tab | URL |
|---|---|
| 1. Supabase | `https://supabase.com/dashboard` |
| 2. Google Cloud | `https://console.cloud.google.com/` |
| 3. This repo | your local `vibejournal` folder |

And one thing ready: **your own Google account email**. You will need it
twice — once for the OAuth consent screen, once for the "test users" list.

---

## Step 1 — Supabase: get your two keys

Supabase dashboard → pick your project → the gear icon (**⚙ Project Settings**)
in the sidebar → **API**.

You want two values from this page:

```
Project URL        →  https://xxxxxxxx.supabase.co
anon (public) key  →  eyJhbGciOi...   (a long string ending in =)
```

> ### ⚠️ The one thing that can go badly wrong
>
> That page shows **two** long keys: `anon (public)` and `service_role`.
>
> **You want `anon (public)`.** The `service_role` key bypasses Row Level
> Security — it is the master key to your database. If it ends up in the
> app, anyone who unpacks the APK owns your data.
>
> The setup tool in Step 4 decodes the key and **refuses** a `service_role`
> key, so you physically cannot paste the wrong one. But if you do it by
> hand, double-check the label before you copy.
>
> Both keys are JWTs starting with `eyJ`. The only difference is the
> payload: `role: "anon"` vs `role: "service_role"`.

**Leave this tab open.** You'll come back to it.

---

## Step 2 — Supabase: run the schema (turns on RLS)

This is the step that actually protects your data, and it is easy to skip.
Don't.

1. Supabase dashboard → sidebar → **SQL Editor** → **New query**
2. Open `tools/supabase-schema.sql` from your repo, select **all** of it,
   copy it
3. Paste it into the SQL editor
4. Click **Run** (bottom right, or press Ctrl/Cmd + Enter)

You should see `Success. No rows returned` or similar.

**Now verify it actually worked.** In the same SQL editor, run this:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
  and tablename in ('trades','shots','settings');
```

You want **three rows**, and every one must say `rowsecurity = true`:

```
    tablename     | rowsecurity
-----------------+--------------
 settings        | t
 shots           | t
 trades          | t
```

If any row says `f`, re-run the schema file. This flag is the *only* thing
between your journal and the public internet — worth the 30 seconds.

---

## Step 3 — Supabase: allow the redirect URLs

Supabase dashboard → sidebar → **Authentication** → **URL Configuration**.

Under **Redirect URLs**, add:

```
https://shah77zaib7.github.io/vibe-journal/**
vibejournal://auth-callback
```

- The first is for the **web app** (PWA). The `**` wildcard covers any
  extra query string Google appends.
- The second is for the **Android app**, which catches the sign-in callback
  via its `vibejournal://` deep link.

Leave **Site URL** as it is. Click **Save**.

> If you host the PWA somewhere else, add that origin too — anything the
> browser can be sent back to must be listed here or Supabase will
> refuse the redirect with a security error.

---

## Step 4 — Google Cloud: create the OAuth client

This is the part that looks scariest. It's a one-time setup, and you only
need one credential.

### 4a. Pick a Google Cloud project

At the top of the Google Cloud Console there's a project dropdown. Either
select an existing project or click **New Project** and make one. (You can
use a fresh project just for this — that's cleanest.)

### 4b. Configure the consent screen

Left menu → **APIs & Services** → **OAuth consent screen**.

First time through, you'll get a **Get started** button:

| Field | What to enter |
|---|---|
| App name | `VibeJournal` |
| User support email | your email |
| Developer contact information | your email |
| Audience | **External** |

Click **Save and Continue** to the **Test users** page:

- Click **+ ADD USERS**
- Add **your own Google account email**
- Click **Save**

> ### 🔑 This step quietly decides whether sign-in works at all
>
> While the consent screen is in **Testing** status, Google only lets
> **users you've explicitly added as test users** sign in. Anyone else
> gets "Access blocked: app not authorised" or a 403.
>
> So: add yourself. If you're the only person using this journal, you can
> leave it in Testing forever — it stays completely private, and you avoid
> Google's app-verification review process entirely.
>
> (You can also click **Publish app** to open it to any Google account.
> Not needed for a personal journal.)

### 4c. Create the credential

Left menu → **APIs & Services** → **Credentials** → **+ CREATE CREDENTIALS**
→ **OAuth client ID**.

| Field | What to enter |
|---|---|
| Application type | **Web application** |
| Name | `VibeJournal` |

Under **Authorized redirect URIs**, add exactly this (replace `xxxx` with
your real project ref from Step 1):

```
https://xxxxxxxx.supabase.co/auth/v1/callback
```

Click **Create**. A popup appears with two values — **Client ID** and
**Client secret**.

### 4d — a note about the client secret

The client secret goes **into the Supabase dashboard, and nowhere else**.

It is *not* like the anon key. Supabase holds it on its server and uses it
to exchange the auth code for a session. Your app never needs it, your
APK never needs it, and it must never be committed to git. The setup tool
below never asks for it, because it isn't needed.

---

## Step 5 — Supabase: paste the Google credentials in

Back in the Supabase dashboard → **Authentication** → **Providers** →
**Google**.

1. Toggle **Enable Sign in with Google** → **on**
2. Paste the **Client ID** from Step 4c into **Client ID**
3. Paste the **Client secret** into **Client Secret**
4. Click **Save**

Leave **Skip nonce check** off.

---

## Step 6 — add your keys to the app

Now the easy bit. From your repo folder:

```bash
node tools/setup-cloud.js
```

It asks for two things:

```
  Project URL (https://xxxx.supabase.co): https://xxxxxxxx.supabase.co
  anon (public) key: •••••••••••••••••••••••••••••••••••••
```

and then it:

- **decodes your key and refuses it if it's a `service_role` key**
- **pings your project** to prove the URL and key actually work
- **writes `js/config.js` for you**

When it finishes it prints a reminder to run the schema and enable Google —
you've already done both.

<details>
<summary>Doing it by hand instead</summary>

Open `js/config.js` and put your values in:

```js
supabaseUrl: 'https://xxxxxxxx.supabase.co',
supabaseAnonKey: 'eyJhbGciOi...',
```

Leave `oauthRedirectWeb` blank — the app works out the right URL for
itself. Don't touch anything else.

</details>

---

## Step 7 — the Android app needs a rebuild

> ### 📱 Read this one
>
> The APK you downloaded was built **before** you had a Supabase project, so
> it has **no keys baked in** — the cloud button will say "Not set up".
>
> The keys live in `js/config.js`, which gets compiled *into* the APK. So
> the app has to be rebuilt after you add them.

```bash
# from your repo folder
bash tools/build-apk.sh
```

The new APK lands at:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Copy it to your phone and install it over the old one.

> The PWA needs no rebuild — just add the keys and reload the page. For
> GitHub Pages, commit `js/config.js` and the page will pick it up.
>
> (Committing the **anon** key to a public repo is standard and safe —
> it's designed to be public. RLS is what protects the data. Still
> **never** commit the `service_role` key.)

---

## Step 8 — try it

1. Open the app → sidebar → the **cloud icon**
2. **Continue with Google**
3. Pick your Google account
4. You should land back in the app, signed in

Then, to confirm sync is really working:

- **Add a trade** on your phone
- Open the app on another device (or the PWA in another browser) and sign
  in with the same Google account
- The trade should appear

If the trade shows up but the screenshot doesn't, that's a separate
issue — check the `shots` bucket in Supabase Storage.

---

## Troubleshooting

**"Sign-in failed" / immediately back to signed-out**

The redirect URL isn't allowlisted. Re-check **Step 3** — both entries
must be there, and the wildcards have to be right.

**"Access blocked: app not authorised" (a Google error page)**

Your Google account isn't in the **Test users** list. Go back to Step 4b.

**"Invalid API key"**

You pasted the wrong key, or the URL has a typo. Re-run
`node tools/setup-cloud.js` — it pings your project and will tell you
which one is wrong.

**The cloud button says "Not set up" in the Android app**

The APK was built before you added the keys. Rebuild (Step 7).

**Sign-in works but nothing syncs**

Check the `trades` table in Supabase → **Data**. If it's empty, the push
failed — open the app's Settings → Cloud section and look for an error
message. Most often this is the schema not having been run, so RLS is
rejecting every write.

**Everything syncs but it's slow**

The app syncs on change, on foreground, and every 60 seconds. You can
force one right now with the **Sync now** button in Settings → Cloud.
