const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const TARGETS = {
  follows: [
    { name: "Loosly", id: "9158302482" },
    { name: "Devsplaces", id: "6080558258" },
  ],
  group: { name: "SHM", id: "351622539" },
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
  return { inGroup: !!found };
}

async function getFollowedTargets(userId, targetIds) {
  const matched = new Set();
  const remaining = new Set(targetIds.map(String));
  let cursor = "";
  for (let page = 0; page < 25 && remaining.size > 0; page++) {
    const url = new URL(`https://friends.roblox.com/v1/users/${userId}/followings`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("sortOrder", "Desc");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url.toString());
    if (!res.ok) return { error: "api_error" };
    const data = await res.json();
    for (const u of data.data || []) {
      const id = String(u.id);
      if (remaining.has(id)) {
        matched.add(id);
        remaining.delete(id);
      }
    }
    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
  }
  return { matched };
}

const checkCommand = new SlashCommandBuilder()
  .setName("check")
  .setDescription("Check if a Roblox account follows the target users and is in the target group.")
  .addStringOption((opt) =>
    opt
      .setName("account")
      .setDescription("Roblox username or user ID")
      .setRequired(true)
      .setMaxLength(50),
  );

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: [checkCommand.toJSON()],
  });
  console.log("Slash command /check registered globally.");
}

const yes = "✅ Yes";
const no = "❌ No";
const apiErr = "⚠️ API error";

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "check") return;

  const query = interaction.options.getString("account", true).trim();
  await interaction.deferReply();

  const user = await resolveRobloxUser(query);
  if (user.error === "not_found") {
    return interaction.editReply(`Could not find a Roblox user named \`${query}\`.`);
  }
  if (user.error) {
    return interaction.editReply("Roblox API error while resolving the username. Please try again.");
  }

  const followIds = TARGETS.follows.map((t) => t.id);
  const [groupRes, followRes] = await Promise.all([
    isInGroup(user.id, TARGETS.group.id),
    getFollowedTargets(user.id, followIds),
  ]);

  const profileUrl = `https://www.roblox.com/users/${user.id}/profile`;

  const fields = TARGETS.follows.map((t) => ({
    name: `Follows ${t.name}  (${t.id})`,
    value: followRes.error ? apiErr : followRes.matched.has(t.id) ? yes : no,
  }));
  fields.push({
    name: `In Group ${TARGETS.group.name} (${TARGETS.group.id})`,
    value: groupRes.error ? apiErr : groupRes.inGroup ? yes : no,
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${user.displayName} (@${user.name})`)
    .setURL(profileUrl)
    .addFields(fields);

  await interaction.editReply({ embeds: [embed] });
});

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }
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
