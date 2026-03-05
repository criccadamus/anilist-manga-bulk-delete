# Anilist Bulk Manga Deleter

Deletes all manga entries and manga-related activities from your Anilist account while leaving anime entries and activities untouched.

## What This Script Does

1. **Deletes manga list entries**: Removes all manga from your lists (Reading, Completed, Planned, Dropped, etc.)
2. **Deletes manga activities**: Removes manga-related posts from your activity feed:
   - List activities (e.g., "read chapter 5", "completed", "dropped")
   - Text posts containing manga-related keywords (manga, chapter, volume, read, reading, manhwa, manhua, webtoon, light novel)

**Note**: This script deletes both list entries AND activities. Anime entries and anime-related activities are preserved.

## Prerequisites

- [Bun](https://bun.sh/) runtime installed

## Getting Your Anilist Access Token

To use this script, you need to obtain an access token from Anilist:

1. Go to https://anilist.co/settings/developer
2. Create a new API client:
   - **Name**: Give it any name (e.g., "Manga Bulk Deleter")
   - **Redirect URI**: `https://anilist.co/api/v2/oauth/pin`
3. Click "Save"
4. Copy your **Client ID**
5. Open this URL in your browser (replace `YOUR_CLIENT_ID` with your actual Client ID):
   ```txt
   https://anilist.co/api/v2/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=token
   ```
6. Authorize the application
7. You'll be redirected to a page with your access token in the URL
8. Copy the access token

## Usage

```bash
bun index.ts [ACCESS_TOKEN] [USERNAME]
```

If no parameters are provided, the script will automatically use values from your `.env` file or shell profile environment variables (e.g., `~/.zshrc`, `~/.bashrc`).
