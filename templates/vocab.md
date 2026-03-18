# /vocab

Receives a content URL (Podcast / YouTube / Blog), automatically fetches the transcript, generates language learning notes, and writes them to Notion.

Language settings are loaded from `.vocabot.json`: `pageId` (Notion parent page), `originalLanguage` (source), `targetLanguage` (translation), `targetLevel` (proficiency).

## Usage

```
/vocab <url>
```

---

## Execution Steps

### Step 0: Verify Configuration and Notion Setup

1. Read `.env` and `.vocabot.json` (parallel)
2. Find or create the Vocab database using Notion REST API (via `curl`):
   - `GET /v1/blocks/{pageId}/children` → look for `child_database` type named "Vocab"
   - If found → use its ID
   - If not found → `POST /v1/databases` to create "Vocab" under `pageId` with schema: `Name` (title), `Tags` (multi_select), `Review` (checkbox), `Created` (created_time)
   - Cache the database ID for this session

**Important:** Always use Notion REST API directly via `curl` (with `NOTION_TOKEN` from `.env`). Do NOT rely on Notion MCP tools — they require a session restart after first config and add unnecessary latency.

### Step 1: Determine Content Type and Retrieve Metadata

**Run in parallel:**
- Fetch metadata (title, channel, date, duration)
- Pre-check tool availability (`yt-dlp` — try `yt-dlp --version`, then `python3 -m yt_dlp --version`)

Determine content type from URL **and** metadata:
- URL contains `ted.com/talks/` → `TED`
- URL contains `youtube.com` or `youtu.be` → fetch oembed (`https://www.youtube.com/oembed?url={url}&format=json`), check `author_name`:
  - If channel contains `TED` (e.g., "TED", "TEDx Talks", "TED-Ed") → reclassify as `TED`, find TED talk slug
  - Otherwise → `YouTube`
- URL contains podcast-related domains → `Podcast`
- Otherwise → `Blog`

Metadata to collect:
- **Type**: `Podcast` / `YouTube` / `TED` / `Blog`
- **Show / Channel name**
- **Episode / Video title**
- **Host** (if available)
- **Speaker** (if available)
- **Publish date**
- **Duration** (minutes)

### Step 2: Fetch Transcript

**Token-saving rules:**
- Use `WebFetch` with a focused prompt (e.g., "Extract only the transcript text") instead of raw `Fetch` to avoid loading full HTML into context
- Never fetch the full YouTube page (1MB+) — use oembed or yt-dlp instead
- For TED: fetch only the `/transcript` URL, never the main talk page
- Fetch only ONE source — stop at first success, don't fetch fallbacks in parallel
- **Do NOT install packages at runtime** (no `pip install`, no `npm install`). Use only what's already available. If yt-dlp is missing, skip to web search immediately.

**YouTube:**
1. If yt-dlp is available (from Step 1 pre-check), run ONE command:
   `yt-dlp --write-sub --write-auto-sub --sub-lang en,zh-Hant,zh-Hans --skip-download --no-warnings -o "{id}" "{url}"`
   This tries manual subs first, falls back to auto-subs, in a single call. Then read the resulting `.vtt`/`.srt` file.
2. If yt-dlp is not available → skip directly to web search: `"{title}" transcript`

**TED Talks** (URL contains `ted.com/talks/` OR YouTube video from TED channel):
1. Resolve the TED `/transcript` URL:
   - If from `ted.com` → append `/transcript` to URL
   - If from YouTube → search: `site:ted.com/talks "{video title}"` → append `/transcript`
2. Use `WebFetch` on the `/transcript` URL with prompt: "Extract only the transcript text, no navigation or metadata"
3. If failed → search: `site:happyscribe.com "{talk title}"`

**Podcast:**
1. Scrape page show notes for transcript links
2. Search: `"{episode title}" transcript site:podscribe.app OR site:taddy.org OR site:happyscribe.com`
3. Attempt to get audio URL from RSS feed → present to user as fallback
4. If not found, mark as `[Transcript not available]`

**Blog:**
1. Use `WebFetch` with prompt: "Extract only the article body text" to avoid loading full page HTML

### Step 3: Generate Learning Content

After obtaining the transcript, analyze and generate the following four sections:

#### 📄 Transcript
Source link only — do NOT include the full transcript text. Just store the URL where the transcript can be found (e.g., TED talk page, YouTube URL, podcast page). This saves tokens and avoids Notion's 2000-char limit.

#### 📖 Vocabulary List (in order of appearance)

Select 10–20 words or phrases worth learning based on `targetLevel` (slightly above learner proficiency, skip overly basic items), formatted as a table:

| Word/Phrase | POS | {targetLanguage} Translation | Level | Original Sentence |
|-------------|-----|----------------------------------|-------|--------------------|

- **POS**: n. / v. / adj. / adv. / phrase, etc.
- **Level**: Use the proficiency scale corresponding to `originalLanguage` (English → CEFR, Japanese → JLPT, Korean → TOPIK, etc.), or follow the custom format of `targetLevel`
- **Original Sentence**: Extract the full sentence containing the word from the transcript

#### 🔑 Key Phrases (in order of appearance)

Select 5–10 idiomatic phrases, collocations, or colloquial expressions, formatted as a table:

| Phrase | {targetLanguage} Translation | Original Sentence |
|--------|----------------------------------|--------------------|

#### ✨ Good Sentences

Select 4–6 memorable sentences worth remembering, listed line by line (no numbering).

### Step 4: Write to Notion

Use Notion REST API (via `curl`) to create a new page in the "Vocab" database (found/created in Step 0). Use `NOTION_TOKEN` from `.env` for authorization.

**Page Structure:**

```
[callout block]
🎙️ {Type}: {Show Name} "{Episode Title}" | {Speaker}
Date: {date} | Duration: {duration} min
Host: {Host} | Speaker: {Speaker}

📄 Transcript
(source URL link only, no full text)

📖 Vocabulary List (in order of appearance)
(table)

🔑 Key Phrases (in order of appearance)
(table)

✨ Good Sentences
(listed line by line)
```

**Database Properties:**

| Field | Content |
|-------|---------|
| Name | Episode / video title |
| Tags | Content type tag (e.g., `Blog`, `YouTube`, `TED`, `Podcast`) |
| Review | `false` (default) |

Remaining metadata (URL, type, show name, speaker, date, duration) goes in the callout block within the page.

### Done

Output confirmation message:
```
✅ Saved: "{title}" → Notion
```

On failure, explain the reason and ask whether to skip that section and continue.

---

## Examples

```
/vocab https://www.ted.com/talks/lauren_deeley_what_would_your_deathbed_self_tell_you_today
/vocab https://www.youtube.com/watch?v=xxxx
/vocab https://podcasts.apple.com/tw/podcast/example/id123?i=456
```
