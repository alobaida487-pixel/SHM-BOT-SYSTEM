# Roblox Check Discord Bot

A small Discord bot that verifies whether a Roblox account follows a specific user and is a member of a specific group.

## Commands

- `/check account:<roblox_username_or_id>` — looks up the Roblox account and reports:
  - whether it follows Loosly (`9158302482`)
  - whether it follows Devsplaces (`6080558258`)
  - whether it is in group SHM (`351622539`)

  Each check is shown as a separate embed field with a ✅ Yes / ❌ No value.

- `/giveaway start prize:<text> duration:<e.g. 10m, 2h, 1d>` — posts a giveaway embed with an "Enter Giveaway" button. Auto-ends after the duration and edits the message into the "Ended" form with the winner.
- `/giveaway end id:<n>` — ends a giveaway immediately.
- `/giveaway reroll id:<n>` — rerolls the winner of an already-ended giveaway.

The `/giveaway` command requires the **Manage Events** permission.

Slash commands are registered globally on startup. New global commands may take up to an hour to appear the first time.

## Storage

Giveaways are persisted to `data/giveaways.json` so pending giveaways resume after a restart. The `data/` directory is gitignored.

## Tech

- Node.js 20
- discord.js v14
- Public Roblox web APIs (no auth required):
  - `users.roblox.com` — username/ID resolution
  - `groups.roblox.com` — group membership
  - `friends.roblox.com` — followings list

## Configuration

- Secret `DISCORD_BOT_TOKEN` — bot token from the Discord Developer Portal.
- Required Discord privileged intent: **Message Content Intent** (enable in the Bot tab).

## Run

Workflow `Discord Bot` runs `node index.js`.
