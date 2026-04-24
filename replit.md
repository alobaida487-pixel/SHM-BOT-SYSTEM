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

- `/verify` — starts Roblox verification in the user's DMs. The bot asks for their Roblox username, generates a random NATO-phonetic code, asks them to add it to their Roblox About Me, then verifies it and updates their server nickname to `DisplayName (@username)`.
- `/cancel` (or just typing `cancel` in DMs) — aborts an in-progress verification.

On successful verification the bot also assigns a role named **Verified** (case-insensitive). The bot needs **Manage Nicknames** and **Manage Roles**, and its top role must sit above both the verifying user's highest role and the Verified role.

Verification sessions expire after 15 minutes of inactivity.

### Tickets

- `/ticket setup category:<category> staff_role:<role> log_channel:<channel>` — one-time setup per server.
- `/ticket panel [title] [description]` — posts a panel with a "Create Ticket" button in the current channel.
- `/ticket close [reason]` — closes the current ticket (also available via the in-channel **Close Ticket** button with a confirmation step).
- `/ticket add user:<user>` — adds a user to the current ticket (staff only).
- `/ticket remove user:<user>` — removes a user from the current ticket (staff only).

Ticket lifecycle:
1. A user clicks the panel button → bot creates a private channel under the configured category, visible only to them, the staff role, and the bot.
2. They chat with staff. Either side clicks **Close Ticket**.
3. The bot generates an HTML transcript (via `discord-html-transcripts`), sends it with a summary embed to the configured log channel, DMs it to the ticket opener, then deletes the channel.

The bot needs **Manage Channels** to create/delete ticket channels and **Attach Files** to post transcripts.

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
