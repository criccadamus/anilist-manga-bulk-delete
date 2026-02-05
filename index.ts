#!/usr/bin/env bun
/**
 * Anilist Manga Bulk Deleter (Bun/TypeScript version)
 * Deletes all manga entries from your Anilist account.
 * Does NOT touch anime entries.
 */

import { argv, env, exit, stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

const API_URL = "https://graphql.anilist.co";

// Colors for output
const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const BLUE = "\x1b[0;34m";
const NC = "\x1b[0m";

const HELP_TEXT = `
${BLUE}#${NC} Anilist Bulk Manga Deleter

Simple scripts to delete all manga entries from your Anilist account while leaving anime entries untouched.

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
const info = (msg: string) => writeln(`${BLUE}❖${NC} ${msg}`);
const success = (msg: string) => writeln(`${GREEN}✓${NC} ${msg}`);
const warning = (msg: string) => writeln(`${YELLOW}⚠${NC} ${msg}`);
const error = (msg: string) => writeErrorLine(`${RED}✗${NC} ${msg}`);

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
    error(`Error fetching manga list: ${response.status}`);
    error(await response.text());
    exit(1);
  }

  const data = (await response.json()) as MediaListCollectionResponse;

  if (data.errors) {
    error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    exit(1);
  }

  if (!data.data?.MediaListCollection) {
    error("No data returned from API");
    exit(1);
  }

  return data.data.MediaListCollection.lists;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function confirm(message: string): Promise<boolean> {
  const reader = createInterface({
    input: stdin,
    output: stdout,
  });
  const answer = (await reader.question(message)).trim().toLowerCase();
  reader.close();
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
): Promise<{ deletedCount: number; failedCount: number }> {
  let deletedCount = 0;
  let failedCount = 0;
  let index = 1;

  for (const entry of entries) {
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

    // Rate limiting: Anilist currently has 30 requests/min limit (degraded state)
    // 2.5s delay = ~24 requests/min to stay safely under limit
    await sleep(2500);
  }

  return { deletedCount, failedCount };
}

function printSummary(deletedCount: number, failedCount: number): void {
  writeln(String("=".repeat(50)));
  success("Deletion complete!");
  writeln(`Successfully deleted: ${GREEN}${deletedCount}${NC}`);
  if (failedCount > 0) {
    writeln(`Failed: ${RED}${failedCount}${NC}`);
  }
  writeln("=".repeat(50));
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  if (args[0] === "--help" || args[0] === "-h") {
    showHelp();
  }

  const { accessToken, username } = getCredentials(args);
  info(`Fetching manga list for user: ${username}`);
  const lists = await getMangaList(accessToken, username);
  const allEntries = collectEntries(lists);

  if (allEntries.length === 0) {
    warning("No manga entries found. Nothing to delete.");
    return;
  }

  info(`Total manga entries to delete: ${allEntries.length}`);
  const confirmed = await confirm(
    `\n${YELLOW}Are you sure you want to delete ALL manga entries?${NC} ${BLUE}(yes/no)${NC}: `,
  );
  if (!confirmed) {
    warning("Deletion cancelled.");
    return;
  }

  info("Starting deletion...");
  const { deletedCount, failedCount } = await deleteEntries(
    accessToken,
    allEntries,
  );
  printSummary(deletedCount, failedCount);
}

main().catch((caught) => {
  error(`Fatal error: ${String(caught)}`);
  exit(1);
});
