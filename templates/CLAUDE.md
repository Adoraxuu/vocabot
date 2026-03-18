# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Startup Sequence

Execute the following steps in order on every startup:

1. **Read `.env`**: Retrieve `NOTION_TOKEN` (API secret, stored only in `.env` for security)
2. **Read `.vocabot.json`**: Load `pageId`, `originalLanguage`, `targetLanguage`, `targetLevel`
3. **Display settings** and ask user to confirm or modify
4. **Check Notion MCP**: Verify Notion MCP tools are available (attempt to call any Notion MCP tool)
   - If available → skip, continue
   - If not available → auto-configure MCP server using `NOTION_TOKEN` from `.env` (write to project-level `.claude/settings.local.json`):
     ```json
     {
       "mcpServers": {
         "notionApi": {
           "command": "npx",
           "args": ["-y", "@notionhq/notion-mcp-server"],
           "env": {
             "NOTION_TOKEN": "<NOTION_TOKEN>"
           }
         }
       }
     }
     ```
5. Startup complete, await user commands

## Project Overview

Automatically fetches transcripts from Blog / YouTube / Podcast content, generates language learning notes in `originalLanguage` (source language), translates using `targetLanguage`, with difficulty calibrated to `targetLevel`, and saves to Notion.

**Workflow:**
1. Receive a content URL (blog article, YouTube video, podcast episode)
2. Find transcript (prefer page content first, fall back to web search)
3. Analyze transcript to generate learning content (vocabulary list, key phrases, good sentences)
4. Write to the specified Database via Notion MCP

The full specification for the `/vocab` command is defined in `.claude/commands/vocab.md`.

---

## Tech Stack

- **Notion Integration**: Notion MCP (token from `.env`, settings from `.vocabot.json`, auto-configured on startup)
- **Transcript Sources**:
  - YouTube: `yt-dlp --write-auto-sub` (preferred) or `youtube-transcript` package
  - Podcast: page description / RSS feed / third-party services (e.g., Podscribe, Taddy)
  - Blog: directly extract page content

---

## Configuration

Settings are split into two files:

### `.env` (secrets only)

```
NOTION_TOKEN=...    # Notion API token — never commit to git
```

### `.vocabot.json` (user preferences)

```json
{
  "pageId": "...",
  "originalLanguage": "English",
  "targetLanguage": "Chinese(Tr)",
  "targetLevel": "B1"
}
```

- `pageId`: The parent Notion page. A child database named "Vocab" will be auto-created under this page on first run.
- Users can modify settings by editing `.vocabot.json` or asking Claude to update it.

**Supported proficiency scales for `targetLevel`:**
- English: CEFR (A1–C2)
- Japanese: JLPT (N5–N1)
- Korean: TOPIK (1–6)
- Chinese: TOCFL (A1–C2)
- Custom: any description (e.g., `intermediate`, `advanced`) — Claude will infer appropriate difficulty

---

## Notion Database Schema

| Field Name | Type | Description |
|------------|------|-------------|
| `Name` | title | Episode / video title |
| `Tags` | multi_select | Content type tags (e.g., `Blog`, `YouTube`, `TED`, `Podcast`) |
| `Review` | checkbox | Whether review is needed |
| `Created` | created_time | Creation time (automatic) |

Remaining metadata (URL, type, show/channel name, speaker, date, duration) goes in a callout block within the page.

Page content structure: callout block (metadata) → Transcript (source link only) → Vocabulary List → Key Phrases → Good Sentences. See `vocab.md` Steps 3 and 4 for details.

---

## Core Logic

See `vocab.md` Step 1–2 for content type detection and transcript retrieval strategy, Step 3 for learning content generation, and Step 4 for Notion write logic.

### Error Handling

- Invalid or unsupported URL → inform user, do not proceed
- Transcript not found → mark Transcript field as `[Transcript not available]` when writing to Notion; fill all other fields as normal
- Notion MCP connection failure → print error, suggest re-running startup sequence
- Notion write failure → print error, **do not** silently ignore

---

## Commands

```
/vocab <url>    # Fetch transcript and write learning notes to Notion
```

Examples:
```
/vocab https://www.ted.com/talks/example_talk
/vocab https://www.youtube.com/watch?v=xxxx
/vocab https://podcasts.apple.com/tw/podcast/example/id123?i=456
```

---

## Known Limitations

- Notion `rich_text` field has a 2000-character limit; long transcripts need to be split or truncated
- YouTube private videos or videos with subtitles disabled cannot provide transcripts
- Some podcast platforms (e.g., Spotify) do not expose public RSS feeds; third-party services are required
