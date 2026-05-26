#!/usr/bin/env bun
/**
 * Anilist Manga Bulk Deleter (Bun/TypeScript version)
 * Deletes all manga entries and manga-related activities from your Anilist account.
 * Does NOT touch anime entries or anime-related activities.
 */

import { argv, env, exit, stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

const API_URL = "https://graphql.anilist.co";

// Colors for output
const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const BLUE = "\x1b[0;34m";
const CYAN = "\x1b[0;36m";
const NC = "\x1b[0m";

// Abort controller for graceful cancellation
let shouldAbort = false;

function setupAbortHandler(): void {
  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    
    stdin.on("data", (key: string) => {
      if (key === "\u001b") {
        if (!shouldAbort) {
          shouldAbort = true;
          stdout.write(`\n${CYAN}⏸${NC} Abort requested - finishing current operation, then stopping...\n`);
        }
      } else if (key === "\u0003") {
        stdout.write(`\n${RED}✗${NC} Force quit\n`);
        exit(1);
      }
    });
  }
}

function checkAbort(): boolean {
  return shouldAbort;
}

const HELP_TEXT = `
${BLUE}#${NC} Anilist Bulk Manga Deleter

Deletes all manga entries and manga-related activities from your Anilist account while leaving anime entries and activities untouched.

${YELLOW}## Prerequisites${NC}

- Bun runtime installed (https://bun.sh/)

${YELLOW}## Getting Your Anilist Access Token${NC}

To use this script, you need to obtain an access token from Anilist:

1. Go to https://anilist.co/settings/developer
2. Create a new API client:
    - Name: Give it any name (e.g., "Manga Bulk Deleter")
    - Redirect URI: https://anilist.co/api/v2/oauth/pin
3. Click "Save"
4. Copy your Client ID
5. Open this URL in your browser (replace YOUR_CLIENT_ID with your actual Client ID):
    https://anilist.co/api/v2/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=token
6. Authorize the application
7. You'll be redirected to a page with your access token in the URL
8. Copy the access token (it's the long string after access_token=)

${YELLOW}## What This Script Does${NC}

1. ${GREEN}Deletes manga list entries${NC}: Removes all manga from your lists (Reading, Completed, Planned, etc.)
2. ${GREEN}Deletes manga activities${NC}: Removes manga-related posts from your activity feed:
   - List activities (e.g., "read chapter X", "completed", "dropped")
   - Text posts containing manga-related keywords (manga, chapter, volume, etc.)

${YELLOW}## Controls${NC}

- Press ${CYAN}ESC${NC} to abort - finishes current operation then stops
- Press ${RED}Ctrl+C${NC} to force quit immediately

${YELLOW}## Usage${NC}

${GREEN}bun${NC} index.ts ${YELLOW}[ACCESS_TOKEN]${NC} ${YELLOW}[USERNAME]${NC}

If no parameters are provided, the script will automatically use values from ${YELLOW}.env${NC} file or shell profile environment variables (e.g., ~/.zshrc, ~/.bashrc).
`;

function writeln(message: string): void {
  stdout.write(String(message));
}

function writeErrorLine(message: string): void {
  stderr.write(String(message));
}

// Logging functions
const info = (msg: string) => writeln(`${BLUE}❖${NC} ${msg}\n`);
const success = (msg: string) => writeln(`${GREEN}✓${NC} ${msg}\n`);
const warning = (msg: string) => writeln(`${YELLOW}⚠${NC} ${msg}\n`);
const error = (msg: string) => writeErrorLine(`${RED}✗${NC} ${msg}\n`);

interface MediaTitle {
  romaji: string | null;
  english: string | null;
}

interface Media {
  id: number;
  title: MediaTitle;
}

interface MediaListEntry {
  id: number;
  media: Media;
}

interface MediaList {
  name: string;
  entries: MediaListEntry[];
}

interface MediaListCollectionResponse {
  data?: {
    MediaListCollection?: {
      lists: MediaList[];
    };
  };
  errors?: unknown[];
}

interface DeleteMediaListEntryResponse {
  data?: {
    DeleteMediaListEntry?: {
      deleted: boolean;
    };
  };
  errors?: unknown[];
}

interface UserResponse {
  data?: {
    User?: {
      id: number;
      name: string;
    };
  };
  errors?: unknown[];
}

interface ListActivity {
  id: number;
  type: "MANGA_LIST" | "ANIME_LIST";
  status: string;
  progress: string | null;
  media: {
    id: number;
    type: "MANGA" | "ANIME";
    title: {
      romaji: string | null;
      english: string | null;
    };
  };
  createdAt: number;
}

interface TextActivity {
  id: number;
  type: "TEXT";
  text: string;
  createdAt: number;
}

type Activity = ListActivity | TextActivity;

interface ActivitiesResponse {
  data?: {
    Page?: {
      pageInfo: {
        hasNextPage: boolean;
      };
      activities: Activity[];
    };
  };
  errors?: unknown[];
}

interface DeleteActivityResponse {
  data?: {
    DeleteActivity?: {
      deleted: boolean;
    };
  };
  errors?: unknown[];
}

async function getMangaList(
  accessToken: string,
  username: string,
): Promise<MediaList[]> {
  const query = `
    query ($username: String, $type: MediaType) {
      MediaListCollection(userName: $username, type: $type) {
        lists {
          name
          entries {
            id
            media {
              id
              title {
                romaji
                english
              }
            }
          }
        }
      }
    }
  `;

  const variables = {
    username,
    type: "MANGA",
  };

  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const baseWaitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
      const waitTime = baseWaitTime + retryCount * 30000;
      warning(
        `Rate limited. Waiting ${waitTime / 1000}s (retry ${retryCount + 1}/${maxRetries})...`,
      );
      await sleep(waitTime);
      retryCount++;
      continue;
    }

    if (!response.ok) {
      error(`Error fetching manga list: ${response.status}`);
      error(await response.text());
      exit(1);
    }

    const data = (await response.json()) as MediaListCollectionResponse;

    if (data.errors) {
      error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      exit(1);
    }

    const mediaListCollection = data.data?.MediaListCollection;
    if (!mediaListCollection) {
      error("No data returned from API");
      exit(1);
    }

    return mediaListCollection.lists;
  }

  error("Failed to fetch manga list after maximum retries");
  exit(1);
}

async function deleteEntry(
  accessToken: string,
  entryId: number,
): Promise<boolean> {
  const mutation = `
    mutation ($id: Int) {
      DeleteMediaListEntry(id: $id) {
        deleted
      }
    }
  `;

  const variables = {
    id: entryId,
  };

  let response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
    stdout.write("\n");
    warning(`Rate limited. Waiting ${waitTime / 1000}s...`);
    await sleep(waitTime);

    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: mutation, variables }),
    });
  }

  if (!response.ok) {
    error(`Error deleting entry ${entryId}: ${response.status}`);
    error(await response.text());
    return false;
  }

  const data = (await response.json()) as DeleteMediaListEntryResponse;

  if (data.errors) {
    error(
      `GraphQL errors for entry ${entryId}: ${JSON.stringify(data.errors)}`,
    );
    return false;
  }

  return true;
}

async function getUserId(
  accessToken: string,
  username: string,
): Promise<number> {
  const query = `
    query ($name: String) {
      User(name: $name) {
        id
        name
      }
    }
  `;

  const variables = {
    name: username,
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    error(`Error fetching user ID: ${response.status}`);
    error(await response.text());
    exit(1);
  }

  const data = (await response.json()) as UserResponse;

  const user = data.data?.User;
  if (data.errors || !user) {
    error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    exit(1);
  }

  return user.id;
}

function isMangaRelatedActivity(activity: Activity): boolean {
  if (activity.type === "MANGA_LIST") {return true;}
  if (activity.type === "TEXT") {
    const text = activity.text.toLowerCase();
    const mangaKeywords = [
      "manga", "chapter", "volume", "read", "reading",
      "manhwa", "manhua", "webtoon", "light novel", "ln",
    ];
    return mangaKeywords.some((keyword) => text.includes(keyword));
  }
  return false;
}

async function fetchActivitiesPage(
  accessToken: string,
  userId: number,
  page: number,
): Promise<{ activities: Activity[]; hasNextPage: boolean }> {
  const query = `
    query ($userId: Int, $page: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo {
          hasNextPage
        }
        activities(userId: $userId, type_in: [MANGA_LIST, TEXT]) {
          ... on ListActivity {
            id
            type
            status
            progress
            createdAt
            media {
              id
              type
              title {
                romaji
                english
              }
            }
          }
          ... on TextActivity {
            id
            type
            text
            createdAt
          }
        }
      }
    }
  `;

  const variables = { userId, page };
  const maxRetries = 3;
  let retryCount = 0;
  let done = false;
  let result: { activities: Activity[]; hasNextPage: boolean } | undefined;

  while (retryCount < maxRetries && !done) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const baseWaitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
      const waitTime = baseWaitTime + retryCount * 30000;
      stdout.write("\n");
      warning(
        `Rate limited. Waiting ${waitTime / 1000}s (retry ${retryCount + 1}/${maxRetries})...`,
      );
      await sleep(waitTime);
      retryCount++;
      continue;
    }

    if (!response.ok) {
      error(`Error fetching activities on page ${page}: ${response.status}`);
      error(await response.text());
      exit(1);
    }

    const data = (await response.json()) as ActivitiesResponse;

    if (data.errors) {
      error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      exit(1);
    }

    const pageData = data.data?.Page;
    if (!pageData) {
      error("No page data returned from API");
      exit(1);
    }

    const pageActivities = pageData.activities;
    result = { activities: pageActivities, hasNextPage: pageData.pageInfo.hasNextPage };
    done = true;
  }

  if (!done) {
    error(
      `Failed to fetch page ${page} after ${maxRetries} retries due to rate limiting`,
    );
    exit(1);
  }

  return result!;
}

async function getMangaActivities(
  accessToken: string,
  userId: number,
): Promise<Activity[]> {
  const allActivities: Activity[] = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const pageResult = await fetchActivitiesPage(accessToken, userId, page);

    for (const activity of pageResult.activities) {
      if (isMangaRelatedActivity(activity)) {
        allActivities.push(activity);
      }
    }

    hasNextPage = pageResult.hasNextPage;
    info(
      `Fetched page ${page}: ${pageResult.activities.length} activities (${allActivities.length} manga-related total)`,
    );

    page++;
    await sleep(3000);
  }

  return allActivities;
}

async function deleteActivity(
  accessToken: string,
  activityId: number,
): Promise<{ success: boolean; alreadyDeleted: boolean }> {
  const mutation = `
    mutation ($id: Int) {
      DeleteActivity(id: $id) {
        deleted
      }
    }
  `;

  const variables = {
    id: activityId,
  };

  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const baseWaitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
      const waitTime = baseWaitTime + retryCount * 30000;
      warning(
        `Rate limited. Waiting ${waitTime / 1000}s (retry ${retryCount + 1}/${maxRetries})...`,
      );
      await sleep(waitTime);
      retryCount++;
      continue;
    }

    if (response.status === 400) {
      const data = (await response.json()) as DeleteActivityResponse;
      if (
        data.errors &&
        JSON.stringify(data.errors).includes("The selected id is invalid")
      ) {
        return { success: true, alreadyDeleted: true };
      }
      return { success: false, alreadyDeleted: false };
    }

    if (!response.ok) {
      return { success: false, alreadyDeleted: false };
    }

    const data = (await response.json()) as DeleteActivityResponse;

    if (data.errors) {
      return { success: false, alreadyDeleted: false };
    }

    return { success: true, alreadyDeleted: false };
  }

  return { success: false, alreadyDeleted: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function confirm(message: string): Promise<boolean> {
  if (stdin.isTTY) {
    stdin.setRawMode(false);
    stdin.pause();
  }
  
  const reader = createInterface({
    input: stdin,
    output: stdout,
  });
  const answer = (await reader.question(message)).trim().toLowerCase();
  reader.close();
  
  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
  }
  
  return answer === "yes";
}

function showHelp(): void {
  writeln(HELP_TEXT);
  exit(0);
}

function showUsageAndExit(): never {
  writeln(
    `Usage: ${BLUE}bun${NC} index.ts ${YELLOW}[ACCESS_TOKEN]${NC} ${YELLOW}[USERNAME]${NC}`,
  );
  writeln(`       ${BLUE}bun${NC} index.ts ${GREEN}--help${NC}`);
  writeln(
    `\nIf no parameters are provided, the script will use values from ${YELLOW}.env${NC} file`,
  );
  writeln(
    "or shell profile environment variables (e.g., ~/.zshrc, ~/.bashrc):",
  );
  writeln(`  ${YELLOW}ACCESS_TOKEN${NC}=your_token_here`);
  writeln(`  ${YELLOW}USERNAME${NC}=your_username_here`);
  writeln(
    `\nSee ${BLUE}README.md${NC} for full instructions on how to get your access token.`,
  );
  exit(1);
}

function getCredentials(args: string[]): {
  accessToken: string;
  username: string;
} {
  const accessToken = args[0] ?? env.ACCESS_TOKEN;
  const username = args[1] ?? env.USERNAME;

  if (!accessToken || !username) {
    showUsageAndExit();
  }

  return { accessToken, username };
}

function collectEntries(lists: MediaList[]): MediaListEntry[] {
  const allEntries: MediaListEntry[] = [];
  for (const list of lists) {
    info(`Found ${list.entries.length} entries in '${list.name}' list`);
    allEntries.push(...list.entries);
  }
  return allEntries;
}

function getMediaTitle(entry: MediaListEntry): string {
  return entry.media.title.romaji || entry.media.title.english || "Unknown";
}

async function deleteEntries(
  accessToken: string,
  entries: MediaListEntry[],
): Promise<{ deletedCount: number; failedCount: number; aborted: boolean }> {
  let deletedCount = 0;
  let failedCount = 0;
  let index = 1;

  for (const entry of entries) {
    if (checkAbort()) {
      warning(`Aborted - ${entries.length - index + 1} entries remaining`);
      return { deletedCount, failedCount, aborted: true };
    }

    const entryId = entry.id;
    const title = getMediaTitle(entry);
    stdout.write(
      `[${index++}/${entries.length}] Deleting: ${title} (ID: ${entryId})... `,
    );

    if (await deleteEntry(accessToken, entryId)) {
      deletedCount++;
      writeln(`${GREEN}✓${NC}`);
    } else {
      failedCount++;
      writeln(`${RED}✗${NC}`);
    }

    await sleep(2500);
  }

  return { deletedCount, failedCount, aborted: false };
}

function getActivityDescription(activity: Activity): string {
  if (activity.type === "TEXT") {
    const preview = activity.text.substring(0, 50);
    return `Text: "${preview}${activity.text.length > 50 ? "..." : ""}"`;
  } else {
    const title =
      activity.media.title.romaji || activity.media.title.english || "Unknown";
    const status = activity.status || "updated";
    const progress = activity.progress ? ` ${String(activity.progress)}` : "";
    return `${title} - ${status}${progress}`;
  }
}

async function deleteActivities(
  accessToken: string,
  activities: Activity[],
): Promise<{ deletedCount: number; failedCount: number; skippedCount: number; aborted: boolean }> {
  let deletedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < activities.length; i++) {
    if (checkAbort()) {
      warning(`Aborted - ${activities.length - i} activities remaining`);
      return { deletedCount, failedCount, skippedCount, aborted: true };
    }

    const activity = activities[i]!;
    const activityId = activity.id;
    const description = getActivityDescription(activity);
    const progress = `[${i + 1}/${activities.length}]`;
    
    stdout.write(`${progress} ${description.substring(0, 60)}... `);

    const result = await deleteActivity(accessToken, activityId);

    if (result.success) {
      if (result.alreadyDeleted) {
        skippedCount++;
        writeln(`${YELLOW}⊘${NC} (already deleted)\n`);
      } else {
        deletedCount++;
        writeln(`${GREEN}✓${NC}\n`);
      }
    } else {
      failedCount++;
      writeln(`${RED}✗${NC}\n`);
    }

    await sleep(3000);
  }

  return { deletedCount, failedCount, skippedCount, aborted: false };
}

function printSummary(
  deletedEntries: number,
  failedEntries: number,
  deletedActivities: number,
  failedActivities: number,
  skippedActivities: number,
): void {
  writeln(String("=".repeat(50)));
  success("Deletion complete!");
  if (deletedEntries > 0 || failedEntries > 0) {
    writeln(`List entries deleted: ${GREEN}${deletedEntries}${NC}`);
    if (failedEntries > 0) {
      writeln(`List entries failed: ${RED}${failedEntries}${NC}`);
    }
  }
  writeln(`Activities deleted: ${GREEN}${deletedActivities}${NC}`);
  if (skippedActivities > 0) {
    writeln(`Activities already deleted: ${YELLOW}${skippedActivities}${NC}`);
  }
  if (failedActivities > 0) {
    writeln(`Activities failed: ${RED}${failedActivities}${NC}`);
  }
  writeln("=".repeat(50));
}

async function handleEntryDeletion(
  accessToken: string,
  allEntries: MediaListEntry[],
): Promise<{ deletedEntries: number; failedEntries: number }> {
  if (allEntries.length === 0) {
    warning("No manga entries found.");
    return { deletedEntries: 0, failedEntries: 0 };
  }

  if (checkAbort()) {
    warning("Aborted before entry deletion");
    return { deletedEntries: 0, failedEntries: 0 };
  }

  info(`Total manga entries to delete: ${allEntries.length}`);
  const confirmed = await confirm(
    `\n${YELLOW}Are you sure you want to delete ALL manga list entries?${NC} ${BLUE}(yes/no)${NC}: `,
  );
  if (!confirmed) {
    warning("List entry deletion cancelled.");
    return { deletedEntries: 0, failedEntries: 0 };
  }

  info("Starting list entry deletion...");
  const result = await deleteEntries(accessToken, allEntries);
  return { deletedEntries: result.deletedCount, failedEntries: result.failedCount };
}

async function handleActivityDeletion(
  accessToken: string,
  userId: number,
): Promise<{ deletedActivities: number; failedActivities: number; skippedActivities: number }> {
  if (checkAbort()) {
    warning("Aborted before activity deletion");
    return { deletedActivities: 0, failedActivities: 0, skippedActivities: 0 };
  }

  info("Fetching manga-related activities...");
  const activities = await getMangaActivities(accessToken, userId);

  if (activities.length === 0) {
    warning("No manga-related activities found.");
    return { deletedActivities: 0, failedActivities: 0, skippedActivities: 0 };
  }

  info(`Total manga-related activities to delete: ${activities.length}`);
  const confirmed = await confirm(
    `\n${YELLOW}Are you sure you want to delete ALL manga-related activities?${NC} ${BLUE}(yes/no)${NC}: `,
  );
  if (!confirmed) {
    warning("Activity deletion cancelled.");
    return { deletedActivities: 0, failedActivities: 0, skippedActivities: 0 };
  }

  info("Starting activity deletion...");
  const result = await deleteActivities(accessToken, activities);
  return {
    deletedActivities: result.deletedCount,
    failedActivities: result.failedCount,
    skippedActivities: result.skippedCount,
  };
}

async function main(): Promise<void> {
  setupAbortHandler();
  
  const args = argv.slice(2);
  if (args[0] === "--help" || args[0] === "-h") {
    showHelp();
  }

  const { accessToken, username } = getCredentials(args);

  info(`Fetching user ID for: ${username}`);
  const userId = await getUserId(accessToken, username);
  success(`User ID: ${userId}`);

  info(`Fetching manga list for user: ${username}`);
  const lists = await getMangaList(accessToken, username);
  const allEntries = collectEntries(lists);

  const entryResult = await handleEntryDeletion(accessToken, allEntries);
  const activityResult = await handleActivityDeletion(accessToken, userId);

  if (allEntries.length > 0 || activityResult.deletedActivities > 0 || activityResult.failedActivities > 0 || activityResult.skippedActivities > 0) {
    printSummary(
      entryResult.deletedEntries,
      entryResult.failedEntries,
      activityResult.deletedActivities,
      activityResult.failedActivities,
      activityResult.skippedActivities,
    );
  }

  if (stdin.isTTY) {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

main().catch((caught) => {
  error(`Fatal error: ${String(caught)}`);
  exit(1);
});
