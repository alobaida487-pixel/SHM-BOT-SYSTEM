# Roblox Check Discord Bot

A small Discord bot that verifies whether a Roblox account follows a specific user and is a member of a specific group.

## Command

- `.check <roblox_username_or_id>` — looks up the Roblox account and reports:
  - whether it follows user ID `9158302482`
  - whether it is in group ID `351622539`

The reply embed shows both target IDs as clickable links to roblox.com and inside backticks so they can be tapped to copy on mobile Discord.

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
