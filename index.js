const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

// ---------- Roblox check config ----------
const TARGETS = {
  follows: [
    { name: "Loosly", id: "9158302482" },
    { name: "Devsplaces", id: "6080558258" },
  ],
  group: { name: "SHM", id: "351622539" },
};

// ---------- Persistence ----------
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "giveaways.json");

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { counter: 0, giveaways: [] };
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { counter: 0, giveaways: [] };
  }
}
function saveData(d) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}
let store = loadData();
function getGiveaway(id) {
  return store.giveaways.find((g) => g.id === id);
}

// ---------- Discord client ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ---------- Roblox helpers ----------
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
async function getRobloxDescription(userId) {
  const res = await fetch(`https://users.roblox.com/v1/users/${userId}`);
  if (!res.ok) return { error: "api_error" };
  const data = await res.json();
  return { text: data.description || "" };
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

// ---------- Duration parsing ----------
function parseDuration(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase().replace(/\s+/g, "");
  const re = /(\d+)(d|h|m|s)/g;
  let total = 0;
  let matched = false;
  let m;
  while ((m = re.exec(s)) !== null) {
    matched = true;
    const n = parseInt(m[1], 10);
    const unit = m[2];
    if (unit === "d") total += n * 86400000;
    else if (unit === "h") total += n * 3600000;
    else if (unit === "m") total += n * 60000;
    else if (unit === "s") total += n * 1000;
  }
  if (!matched) {
    const n = parseInt(s, 10);
    if (!Number.isNaN(n)) total = n * 60000;
  }
  return total > 0 ? total : null;
}

// ---------- Giveaway embeds ----------
function activeEmbed(g) {
  const endTs = Math.floor(g.endsAt / 1000);
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎉 Giveaway #${g.id} 🎉`)
    .setDescription(
      [
        `**Prize:** ${g.prize}`,
        `**Entries:** ${g.entries.length}`,
        `**Ends:** <t:${endTs}:R> (<t:${endTs}:f>)`,
        `**Hosted by:** <@${g.hostId}>`,
        "",
        "Click the 🎉 button below to enter!",
      ].join("\n"),
    );
}
function endedEmbed(g) {
  const winnerLine = g.winnerId
    ? `**Winner:** <@${g.winnerId}>`
    : "**Winner:** No one entered.";
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`🎉 Giveaway #${g.id} Ended 🎉`)
    .setDescription(
      [
        `**Prize:** ${g.prize}`,
        `**Entries:** ${g.entries.length}`,
        winnerLine,
        "",
        g.winnerId ? "Congratulations!" : "Better luck next time!",
      ].join("\n"),
    );
}
function enterRow(g, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${g.id}`)
      .setLabel("Enter Giveaway")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
}

// ---------- Giveaway ending ----------
async function endGiveaway(id) {
  const g = getGiveaway(id);
  if (!g || g.ended) return;
  g.ended = true;
  if (g.entries.length > 0) {
    g.winnerId = g.entries[Math.floor(Math.random() * g.entries.length)];
  } else {
    g.winnerId = null;
  }
  saveData(store);

  try {
    const channel = await client.channels.fetch(g.channelId);
    const msg = await channel.messages.fetch(g.messageId);
    await msg.edit({ embeds: [endedEmbed(g)], components: [enterRow(g, true)] });
    if (g.winnerId) {
      await channel.send({
        content: `🎉 Congratulations <@${g.winnerId}>! You won **${g.prize}** (Giveaway #${g.id}).`,
        allowedMentions: { users: [g.winnerId] },
      });
    }
  } catch (err) {
    console.error(`Failed to finalize giveaway #${id}:`, err.message);
  }
}
function scheduleGiveaway(g) {
  const delay = g.endsAt - Date.now();
  if (delay <= 0) {
    endGiveaway(g.id);
    return;
  }
  setTimeout(() => endGiveaway(g.id), delay);
}

// ---------- Verification ----------
const NATO = [
  "alpha","bravo","charlie","delta","echo","foxtrot","golf","hotel","india",
  "juliet","kilo","lima","mike","november","oscar","papa","quebec","romeo",
  "sierra","tango","uniform","victor","whiskey","xray","yankee","zulu",
];
function generateCode() {
  const out = [];
  for (let i = 0; i < 5; i++) out.push(NATO[Math.floor(Math.random() * NATO.length)]);
  return out.join(" ");
}

// userId -> session
const verifications = new Map();
const VERIFY_TIMEOUT_MS = 15 * 60 * 1000;

function clearVerification(userId) {
  const s = verifications.get(userId);
  if (s?.timeout) clearTimeout(s.timeout);
  verifications.delete(userId);
}
function startVerification(userId, guildId) {
  clearVerification(userId);
  const session = {
    userId,
    guildId,
    state: "awaiting_username",
    robloxUserId: null,
    robloxUsername: null,
    robloxDisplayName: null,
    code: null,
    timeout: setTimeout(() => {
      const s = verifications.get(userId);
      if (!s) return;
      verifications.delete(userId);
      client.users
        .fetch(userId)
        .then((u) => u.send("Verification timed out. Run `/verify` again to restart."))
        .catch(() => {});
    }, VERIFY_TIMEOUT_MS),
  };
  verifications.set(userId, session);
  return session;
}

function verificationStartEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Verification")
    .setDescription("Reply with your Roblox username. You can type `cancel` at any time to abort.");
}
function nextStepEmbed(code) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Next step")
    .setDescription(
      [
        "Add this to your Roblox about me then reply `done`.",
        "If you wish to stop, reply `cancel`.",
        "",
        "```",
        code,
        "```",
      ].join("\n"),
    );
}

const VERIFIED_ROLE_NAME = "Verified";

async function applyVerification(guildId, userId, displayName, username) {
  const guild = await client.guilds.fetch(guildId);
  const member = await guild.members.fetch(userId);
  const desired = `${displayName} (@${username})`.slice(0, 32);

  const result = { nickname: null, nicknameError: null, role: null, roleError: null };

  try {
    await member.setNickname(desired, "Roblox verification");
    result.nickname = desired;
  } catch (err) {
    result.nicknameError = err.message;
  }

  try {
    await guild.roles.fetch();
    const role = guild.roles.cache.find(
      (r) => r.name.toLowerCase() === VERIFIED_ROLE_NAME.toLowerCase(),
    );
    if (!role) {
      result.roleError = `No role named "${VERIFIED_ROLE_NAME}" exists in this server.`;
    } else if (member.roles.cache.has(role.id)) {
      result.role = role.name;
    } else {
      await member.roles.add(role, "Roblox verification");
      result.role = role.name;
    }
  } catch (err) {
    result.roleError = err.message;
  }

  return result;
}

// ---------- Slash command definitions ----------
const checkCommand = new SlashCommandBuilder()
  .setName("check")
  .setDescription("Check if a Roblox account follows the target users and is in the target group.")
  .addStringOption((o) =>
    o.setName("account").setDescription("Roblox username or user ID").setRequired(true).setMaxLength(50),
  );

const giveawayCommand = new SlashCommandBuilder()
  .setName("giveaway")
  .setDescription("Manage giveaways")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
  .addSubcommand((s) =>
    s
      .setName("start")
      .setDescription("Start a new giveaway")
      .addStringOption((o) =>
        o.setName("prize").setDescription("What is being given away").setRequired(true).setMaxLength(200),
      )
      .addStringOption((o) =>
        o
          .setName("duration")
          .setDescription("Duration, e.g. 30s, 10m, 2h, 1d, or 1h30m")
          .setRequired(true)
          .setMaxLength(20),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("end")
      .setDescription("End a giveaway now")
      .addIntegerOption((o) =>
        o.setName("id").setDescription("Giveaway ID number").setRequired(true).setMinValue(1),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("reroll")
      .setDescription("Pick a new winner for an ended giveaway")
      .addIntegerOption((o) =>
        o.setName("id").setDescription("Giveaway ID number").setRequired(true).setMinValue(1),
      ),
  );

const verifyCommand = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("Verify your Roblox account via DM")
  .setDMPermission(false);

const cancelCommand = new SlashCommandBuilder()
  .setName("cancel")
  .setDescription("Cancel your in-progress Roblox verification");

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: [
      checkCommand.toJSON(),
      giveawayCommand.toJSON(),
      verifyCommand.toJSON(),
      cancelCommand.toJSON(),
    ],
  });
  console.log("Slash commands registered globally.");
}

// ---------- Interaction handling ----------
const yes = "✅ Yes";
const no = "❌ No";
const apiErr = "⚠️ API error";

async function handleCheck(interaction) {
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
}

async function handleGiveawayStart(interaction) {
  const prize = interaction.options.getString("prize", true);
  const durationStr = interaction.options.getString("duration", true);
  const ms = parseDuration(durationStr);
  if (!ms) {
    return interaction.reply({
      content: "Invalid duration. Use formats like `30s`, `10m`, `2h`, `1d`, or `1h30m`.",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (ms > 30 * 86400000) {
    return interaction.reply({
      content: "Duration cannot exceed 30 days.",
      flags: MessageFlags.Ephemeral,
    });
  }

  store.counter += 1;
  const g = {
    id: store.counter,
    channelId: interaction.channelId,
    messageId: null,
    prize,
    hostId: interaction.user.id,
    endsAt: Date.now() + ms,
    entries: [],
    ended: false,
    winnerId: null,
  };
  store.giveaways.push(g);

  await interaction.reply({ content: `Giveaway #${g.id} started!`, flags: MessageFlags.Ephemeral });
  const sent = await interaction.channel.send({
    embeds: [activeEmbed(g)],
    components: [enterRow(g)],
  });
  g.messageId = sent.id;
  saveData(store);
  scheduleGiveaway(g);
}
async function handleGiveawayEnd(interaction) {
  const id = interaction.options.getInteger("id", true);
  const g = getGiveaway(id);
  if (!g) return interaction.reply({ content: `Giveaway #${id} not found.`, flags: MessageFlags.Ephemeral });
  if (g.ended) return interaction.reply({ content: `Giveaway #${id} has already ended.`, flags: MessageFlags.Ephemeral });
  g.endsAt = Date.now();
  saveData(store);
  await interaction.reply({ content: `Ending giveaway #${id}...`, flags: MessageFlags.Ephemeral });
  await endGiveaway(id);
}
async function handleGiveawayReroll(interaction) {
  const id = interaction.options.getInteger("id", true);
  const g = getGiveaway(id);
  if (!g) return interaction.reply({ content: `Giveaway #${id} not found.`, flags: MessageFlags.Ephemeral });
  if (!g.ended) return interaction.reply({ content: `Giveaway #${id} hasn't ended yet.`, flags: MessageFlags.Ephemeral });
  if (g.entries.length === 0) {
    return interaction.reply({ content: `Giveaway #${id} had no entries.`, flags: MessageFlags.Ephemeral });
  }
  const newWinner = g.entries[Math.floor(Math.random() * g.entries.length)];
  g.winnerId = newWinner;
  saveData(store);
  try {
    const channel = await client.channels.fetch(g.channelId);
    const msg = await channel.messages.fetch(g.messageId);
    await msg.edit({ embeds: [endedEmbed(g)], components: [enterRow(g, true)] });
    await interaction.reply({
      content: `🎉 New winner for Giveaway #${id}: <@${newWinner}>! You won **${g.prize}**.`,
      allowedMentions: { users: [newWinner] },
    });
  } catch (err) {
    await interaction.reply({ content: `Failed to update message: ${err.message}`, flags: MessageFlags.Ephemeral });
  }
}

async function handleEnterButton(interaction, id) {
  const g = getGiveaway(Number(id));
  if (!g) return interaction.reply({ content: "This giveaway no longer exists.", flags: MessageFlags.Ephemeral });
  if (g.ended) return interaction.reply({ content: "This giveaway has already ended.", flags: MessageFlags.Ephemeral });
  const userId = interaction.user.id;
  if (g.entries.includes(userId)) {
    return interaction.reply({ content: "You're already entered. Good luck!", flags: MessageFlags.Ephemeral });
  }
  g.entries.push(userId);
  saveData(store);
  try {
    await interaction.message.edit({ embeds: [activeEmbed(g)], components: [enterRow(g)] });
  } catch {}
  await interaction.reply({ content: `🎉 You entered Giveaway #${g.id}! Good luck.`, flags: MessageFlags.Ephemeral });
}

async function handleVerify(interaction) {
  if (!interaction.guildId) {
    return interaction.reply({ content: "Run this command from a server.", flags: MessageFlags.Ephemeral });
  }
  try {
    const dm = await interaction.user.createDM();
    await dm.send({ embeds: [verificationStartEmbed()] });
    startVerification(interaction.user.id, interaction.guildId);
    await interaction.reply({ content: "Check your DMs to verify.", flags: MessageFlags.Ephemeral });
  } catch (err) {
    await interaction.reply({
      content: "I couldn't DM you. Please enable DMs from server members and try again.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleCancel(interaction) {
  const had = verifications.has(interaction.user.id);
  clearVerification(interaction.user.id);
  if (had) {
    try {
      const dm = await interaction.user.createDM();
      await dm.send("Verification cancelled.");
    } catch {}
    return interaction.reply({ content: "Verification cancelled.", flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({
    content: "You don't have an active verification to cancel.",
    flags: MessageFlags.Ephemeral,
  });
}

// ---------- DM messages ----------
async function handleDirectMessage(message) {
  const session = verifications.get(message.author.id);
  if (!session) return;
  const content = (message.content || "").trim();
  if (!content) return;

  if (content.toLowerCase() === "cancel") {
    clearVerification(message.author.id);
    return message.reply("Verification cancelled.");
  }

  if (session.state === "awaiting_username") {
    const user = await resolveRobloxUser(content);
    if (user.error === "not_found") {
      return message.reply("I couldn't find that Roblox user. Try again or type `cancel`.");
    }
    if (user.error) {
      return message.reply("Roblox API error. Try again or type `cancel`.");
    }
    session.robloxUserId = user.id;
    session.robloxUsername = user.name;
    session.robloxDisplayName = user.displayName;
    session.code = generateCode();
    session.state = "awaiting_done";
    return message.reply({ embeds: [nextStepEmbed(session.code)] });
  }

  if (session.state === "awaiting_done") {
    if (content.toLowerCase() !== "done") {
      return message.reply("Reply `done` once you've added the code, or `cancel` to abort.");
    }
    const desc = await getRobloxDescription(session.robloxUserId);
    if (desc.error) {
      return message.reply("Roblox API error reading your profile. Reply `done` to retry or `cancel` to abort.");
    }
    if (!desc.text.toLowerCase().includes(session.code.toLowerCase())) {
      return message.reply(
        [
          "I couldn't find the code in your Roblox About Me. Make sure you added:",
          "```",
          session.code,
          "```",
          "Then reply `done` to try again, or `cancel` to abort.",
        ].join("\n"),
      );
    }
    const result = await applyVerification(
      session.guildId,
      message.author.id,
      session.robloxDisplayName,
      session.robloxUsername,
    );
    clearVerification(message.author.id);

    const lines = ["Verified!"];
    if (result.nickname) lines.push(`Nickname set to **${result.nickname}**.`);
    else if (result.nicknameError) lines.push(`Couldn't update nickname: ${result.nicknameError}`);
    if (result.role) lines.push(`Role **${result.role}** assigned.`);
    else if (result.roleError) lines.push(`Couldn't assign verified role: ${result.roleError}`);
    return message.reply(lines.join("\n"));
  }
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.DM) return;
  try {
    await handleDirectMessage(message);
  } catch (err) {
    console.error("DM handler error:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "check") return handleCheck(interaction);
      if (interaction.commandName === "verify") return handleVerify(interaction);
      if (interaction.commandName === "cancel") return handleCancel(interaction);
      if (interaction.commandName === "giveaway") {
        const sub = interaction.options.getSubcommand();
        if (sub === "start") return handleGiveawayStart(interaction);
        if (sub === "end") return handleGiveawayEnd(interaction);
        if (sub === "reroll") return handleGiveawayReroll(interaction);
      }
    } else if (interaction.isButton()) {
      const [ns, action, id] = interaction.customId.split(":");
      if (ns === "giveaway" && action === "enter") return handleEnterButton(interaction, id);
    }
  } catch (err) {
    console.error("Interaction error:", err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: "Something went wrong.", flags: MessageFlags.Ephemeral });
      } catch {}
    }
  }
});

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }
  for (const g of store.giveaways) {
    if (!g.ended) scheduleGiveaway(g);
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
