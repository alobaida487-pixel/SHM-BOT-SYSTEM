const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

const TARGET_USER_ID = "9158302482";
const TARGET_GROUP_ID = "351622539";
const PREFIX = ".check";

const TARGET_USER_URL = `https://www.roblox.com/users/${TARGET_USER_ID}/profile`;
const TARGET_GROUP_URL = `https://www.roblox.com/communities/${TARGET_GROUP_ID}`;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function resolveRobloxUser(input) {
  const trimmed = String(input).trim().replace(/^@/, "");
  if (/^\d+$/.test(trimmed)) {
    const res = await fetch(`https://users.roblox.com/v1/users/${trimmed}`);
    if (res.status === 404) return { error: "not_found" };
    if (!res.ok) return { error: "api_error" };
    const data = await res.json();
    return { id: String(data.id), name: data.name, displayName: data.displayName };
  }
  const res = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [trimmed], excludeBannedUsers: false }),
  });
  if (!res.ok) return { error: "api_error" };
  const data = await res.json();
  if (!data.data || data.data.length === 0) return { error: "not_found" };
  const u = data.data[0];
  return { id: String(u.id), name: u.name, displayName: u.displayName };
}

async function isInGroup(userId, groupId) {
  const res = await fetch(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
  if (!res.ok) return { error: "api_error" };
  const data = await res.json();
  const found = (data.data || []).find((g) => String(g.group?.id) === String(groupId));
  return { inGroup: !!found, role: found?.role?.name || null };
}

async function isFollowing(userId, targetUserId) {
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const url = new URL(`https://friends.roblox.com/v1/users/${userId}/followings`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("sortOrder", "Desc");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url.toString());
    if (!res.ok) return { error: "api_error" };
    const data = await res.json();
    if ((data.data || []).some((u) => String(u.id) === String(targetUserId))) {
      return { following: true };
    }
    if (!data.nextPageCursor) return { following: false };
    cursor = data.nextPageCursor;
  }
  return { following: false, truncated: true };
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();
  if (!content.toLowerCase().startsWith(PREFIX)) return;

  const args = content.slice(PREFIX.length).trim().split(/\s+/).filter(Boolean);

  if (args.length === 0) {
    const help = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Roblox Check")
      .setDescription(
        [
          "Usage: `.check <roblox_username_or_id>`",
          "",
          `Verifies the account follows [the target user](${TARGET_USER_URL}) and is in [the target group](${TARGET_GROUP_URL}).`,
          "",
          `**User ID:** [\`${TARGET_USER_ID}\`](${TARGET_USER_URL})`,
          `**Group ID:** [\`${TARGET_GROUP_ID}\`](${TARGET_GROUP_URL})`,
        ].join("\n"),
      );
    await message.reply({ embeds: [help] });
    return;
  }

  const query = args.join(" ");
  let working;
  try {
    working = await message.reply(`Checking \`${query}\`...`);
  } catch {}

  const user = await resolveRobloxUser(query);
  if (user.error === "not_found") {
    const reply = `Could not find a Roblox user named \`${query}\`.`;
    if (working) return working.edit(reply);
    return message.reply(reply);
  }
  if (user.error) {
    const reply = "Roblox API error while resolving the username. Please try again.";
    if (working) return working.edit(reply);
    return message.reply(reply);
  }

  const [groupRes, followRes] = await Promise.all([
    isInGroup(user.id, TARGET_GROUP_ID),
    isFollowing(user.id, TARGET_USER_ID),
  ]);

  const profileUrl = `https://www.roblox.com/users/${user.id}/profile`;
  const inGroupLine = groupRes.error
    ? "Group check: API error"
    : groupRes.inGroup
    ? `In group: Yes${groupRes.role ? ` (role: ${groupRes.role})` : ""}`
    : "In group: No";
  const followLine = followRes.error
    ? "Follow check: API error"
    : followRes.following
    ? "Following user: Yes"
    : followRes.truncated
    ? "Following user: Not found in first 2000 follows"
    : "Following user: No";

  const allOk =
    !groupRes.error && !followRes.error && groupRes.inGroup && followRes.following;
  const color = allOk ? 0x57f287 : 0xed4245;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${user.displayName} (@${user.name})`)
    .setURL(profileUrl)
    .setDescription(
      [
        `**Roblox ID:** [\`${user.id}\`](${profileUrl})`,
        "",
        `**Target user:** [\`${TARGET_USER_ID}\`](${TARGET_USER_URL})`,
        `**Target group:** [\`${TARGET_GROUP_ID}\`](${TARGET_GROUP_URL})`,
        "",
        followLine,
        inGroupLine,
        "",
        allOk
          ? "Verified — meets all requirements."
          : "Not verified — at least one requirement is missing.",
      ].join("\n"),
    )
    .setFooter({ text: "Tip: tap the IDs above to copy on mobile." });

  if (working) {
    await working.edit({ content: null, embeds: [embed] });
  } else {
    await message.reply({ embeds: [embed] });
  }
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("Missing DISCORD_BOT_TOKEN environment variable.");
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error("Failed to log in to Discord:", err.message);
  process.exit(1);
});
