const fs = require("fs");
const path = require("path");
const express = require("express");
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
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

const TICKET_CATEGORIES = [
  { value: "support",  label: "General Support", description: "Help with the server or game", emoji: "🛠️" },
  { value: "report",   label: "Report a User",   description: "Report rule-breaking behavior", emoji: "🚨" },
  { value: "purchase", label: "Purchase / Buy",  description: "Buying products or services",   emoji: "💰" },
  { value: "other",    label: "Other",           description: "Anything else",                  emoji: "❓" },
];
function getCategory(value) {
  return TICKET_CATEGORIES.find((c) => c.value === value) || TICKET_CATEGORIES[0];
}

const START_TIME = Date.now();
let ownerId = null;

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(" ");
}

async function dmOwner(payload) {
  if (!ownerId) return;
  try {
    const owner = await client.users.fetch(ownerId);
    await owner.send(payload);
  } catch (err) {
    console.error("Failed to DM owner:", err.message);
  }
}

// ---------- Roblox check config ----------
const TARGETS = {
  follows: [
    { name: "Loosly", id: "9158302482" },
    { name: "Devsplaces", id: "6080558258" },
  ],
  group: { name: "SHM", id: "273494562" },
};

// ---------- Persistence ----------
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "giveaways.json");

function defaultData() {
  return {
    counter: 0,
    giveaways: [],
    ticketCounter: 0,
    ticketConfig: {},
    ticketMenus: {},
    tickets: [],
  };
}
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return defaultData();
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return { ...defaultData(), ...data };
  } catch {
    return defaultData();
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

// ---------- Tickets ----------
let transcriptsLib = null;
async function getTranscripts() {
  if (transcriptsLib) return transcriptsLib;
  try {
    transcriptsLib = require("discord-html-transcripts");
  } catch {
    const mod = await import("discord-html-transcripts");
    transcriptsLib = mod.default || mod;
  }
  return transcriptsLib;
}

function getTicketConfig(guildId) {
  return store.ticketConfig[guildId] || null;
}
function getGuildCategories(guildId) {
  const list = store.ticketMenus?.[guildId];
  if (Array.isArray(list) && list.length) return list;
  return TICKET_CATEGORIES;
}
function getCategoryFor(guildId, value) {
  const list = getGuildCategories(guildId);
  return list.find((c) => c.value === value) || list[0] || TICKET_CATEGORIES[0];
}
function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "ticket";
}
function getTicketByChannel(channelId) {
  return store.tickets.find((t) => t.channelId === channelId);
}
function getOpenTicketByUser(guildId, userId) {
  return store.tickets.find(
    (t) => t.guildId === guildId && t.userId === userId && !t.closed,
  );
}

function ticketPanelEmbed(categories, opts = {}) {
  const lines = categories
    .map((c) => `${c.emoji} **${c.label}** — ${c.description}`)
    .join("\n");
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(opts.title || "Support Tickets")
    .setDescription(
      (opts.description ||
        "Need help? Pick a category from the menu below to open a private ticket. A staff member will be with you shortly.") +
        "\n\n" + lines,
    );
}
function ticketPanelRow(categories) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket:create")
    .setPlaceholder("Select a ticket category…")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      categories.slice(0, 25).map((c) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(c.label)
          .setValue(c.value)
          .setDescription(c.description || " ")
          .setEmoji(c.emoji),
      ),
    );
  return new ActionRowBuilder().addComponents(menu);
}
function ticketWelcomeEmbed(ticket, owner) {
  const cat = getCategoryFor(ticket.guildId, ticket.category);
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Ticket #${ticket.id} • ${cat.emoji} ${cat.label}`)
    .setDescription(
      `Hello <@${owner.id}>, support will be with you shortly.\nDescribe your issue here. When you're done, click **Close Ticket** below.`,
    )
    .setTimestamp(new Date(ticket.createdAt));
}
function ticketActionRow(ticket) {
  const claimBtn = new ButtonBuilder()
    .setCustomId("ticket:claim")
    .setLabel(ticket.claimedBy ? "Claimed" : "Claim")
    .setEmoji("✋")
    .setStyle(ticket.claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(!!ticket.claimedBy);
  const closeBtn = new ButtonBuilder()
    .setCustomId("ticket:close")
    .setLabel("Close Ticket")
    .setEmoji("🔒")
    .setStyle(ButtonStyle.Danger);
  return new ActionRowBuilder().addComponents(claimBtn, closeBtn);
}
function ticketConfirmCloseRow(ticketId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:close_confirm:${ticketId}`)
      .setLabel("Confirm Close")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ticket:close_cancel:${ticketId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );
}

async function isStaffMember(guild, member, cfg) {
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  if (cfg?.staffRoleId && member.roles.cache.has(cfg.staffRoleId)) return true;
  return false;
}

async function createTicketChannel(interaction, cfg, categoryValue = "support") {
  const guild = interaction.guild;
  const category = getCategoryFor(guild.id, categoryValue);
  store.ticketCounter += 1;
  const ticketId = store.ticketCounter;
  const baseName = `${category.value}-${interaction.user.username}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 90) || `ticket-${ticketId}`;

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];
  if (cfg.staffRoleId) {
    overwrites.push({
      id: cfg.staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: baseName,
    type: ChannelType.GuildText,
    parent: cfg.categoryId || null,
    permissionOverwrites: overwrites,
    topic: `Ticket #${ticketId} • Opened by ${interaction.user.tag} (${interaction.user.id})`,
  });

  const ticket = {
    id: ticketId,
    guildId: guild.id,
    channelId: channel.id,
    userId: interaction.user.id,
    category: category.value,
    createdAt: Date.now(),
    closed: false,
    closedBy: null,
    closedAt: null,
    claimedBy: null,
    claimedAt: null,
    panelMessageId: null,
  };
  store.tickets.push(ticket);
  saveData(store);

  const pingContent = cfg.staffRoleId
    ? `<@${interaction.user.id}> <@&${cfg.staffRoleId}>`
    : `<@${interaction.user.id}>`;
  const sent = await channel.send({
    content: pingContent,
    embeds: [ticketWelcomeEmbed(ticket, interaction.user)],
    components: [ticketActionRow(ticket)],
    allowedMentions: { users: [interaction.user.id], roles: cfg.staffRoleId ? [cfg.staffRoleId] : [] },
  });
  ticket.panelMessageId = sent.id;
  saveData(store);

  return { ticket, channel };
}

async function handleTicketClaimButton(interaction) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.closed) {
    return interaction.reply({ content: "This ticket is no longer open.", flags: MessageFlags.Ephemeral });
  }
  const cfg = getTicketConfig(interaction.guildId);
  if (!(await isStaffMember(interaction.guild, interaction.member, cfg))) {
    return interaction.reply({ content: "Only staff can claim tickets.", flags: MessageFlags.Ephemeral });
  }
  if (ticket.claimedBy) {
    return interaction.reply({
      content: `This ticket is already claimed by <@${ticket.claimedBy}>.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }
  ticket.claimedBy = interaction.user.id;
  ticket.claimedAt = Date.now();
  saveData(store);

  try {
    if (ticket.panelMessageId) {
      const msg = await interaction.channel.messages.fetch(ticket.panelMessageId);
      await msg.edit({ components: [ticketActionRow(ticket)] });
    }
  } catch {}

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setDescription(`✋ Ticket claimed by <@${interaction.user.id}>.`),
    ],
    allowedMentions: { parse: [] },
  });
}

async function finalizeTicketClose(ticket, channel, closer, reason) {
  ticket.closed = true;
  ticket.closedBy = closer.id;
  ticket.closedAt = Date.now();
  ticket.closeReason = reason || null;
  saveData(store);

  const cfg = getTicketConfig(ticket.guildId);

  let attachment = null;
  try {
    const transcripts = await getTranscripts();
    attachment = await transcripts.createTranscript(channel, {
      limit: -1,
      filename: `ticket-${ticket.id}.html`,
      saveImages: false,
      poweredBy: false,
    });
  } catch (err) {
    console.error("Transcript creation failed:", err);
  }

  const opener = await client.users.fetch(ticket.userId).catch(() => null);
  const claimer = ticket.claimedBy
    ? await client.users.fetch(ticket.claimedBy).catch(() => null)
    : null;
  const summary = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`Ticket #${ticket.id} closed`)
    .addFields(
      { name: "Opened by", value: opener ? `<@${opener.id}> (${opener.tag})` : ticket.userId, inline: true },
      { name: "Closed by", value: `<@${closer.id}> (${closer.tag})`, inline: true },
      { name: "Claimed by", value: claimer ? `<@${claimer.id}> (${claimer.tag})` : "Unclaimed", inline: true },
      { name: "Channel", value: `#${channel.name}`, inline: true },
      { name: "Opened", value: `<t:${Math.floor(ticket.createdAt / 1000)}:f>`, inline: true },
      { name: "Closed", value: `<t:${Math.floor(ticket.closedAt / 1000)}:f>`, inline: true },
      { name: "Reason", value: reason || "No reason provided", inline: false },
    );

  const logPayload = { embeds: [summary] };
  if (attachment) logPayload.files = [attachment];

  let logStatus = "skipped";
  let logError = null;
  if (!cfg?.logChannelId) {
    logStatus = "no_channel";
    console.warn(`[ticket #${ticket.id}] No log channel configured for guild ${ticket.guildId}. Run /ticket setup.`);
  } else {
    try {
      const logCh = await client.channels.fetch(cfg.logChannelId);
      await logCh.send(logPayload);
      logStatus = "sent";
      console.log(`[ticket #${ticket.id}] Transcript sent to #${logCh.name}`);
    } catch (err) {
      logStatus = "failed";
      logError = err.message;
      console.error(`[ticket #${ticket.id}] Failed to send transcript to log channel ${cfg.logChannelId}:`, err.message);
    }
  }

  if (opener) {
    try {
      const dm = await opener.createDM();
      await dm.send({
        content: `Your ticket #${ticket.id} in **${channel.guild.name}** has been closed.`,
        ...logPayload,
      });
    } catch {}
  }

  return { logStatus, logError };
}

async function notifyCloserOfLogIssue(closer, ticket, result) {
  if (result.logStatus === "sent") return;
  let msg;
  if (result.logStatus === "no_channel") {
    msg = `Heads up: ticket #${ticket.id} closed, but **no log channel is set** for this server. An admin should run \`/ticket setup\` to pick one.`;
  } else if (result.logStatus === "failed") {
    msg = `Heads up: ticket #${ticket.id} closed, but I couldn't post the transcript to the log channel. Reason: \`${result.logError}\`. Check that I can see the channel and have **Send Messages**, **Embed Links**, and **Attach Files** there.`;
  } else {
    return;
  }
  try {
    const dm = await closer.createDM();
    await dm.send(msg);
  } catch {}
}

async function handleTicketSetup(interaction) {
  const category = interaction.options.getChannel("category", true);
  const staffRole = interaction.options.getRole("staff_role", true);
  const logChannel = interaction.options.getChannel("log_channel", true);

  if (category.type !== ChannelType.GuildCategory) {
    return interaction.reply({ content: "`category` must be a category channel.", flags: MessageFlags.Ephemeral });
  }
  if (logChannel.type !== ChannelType.GuildText) {
    return interaction.reply({ content: "`log_channel` must be a text channel.", flags: MessageFlags.Ephemeral });
  }

  store.ticketConfig[interaction.guildId] = {
    categoryId: category.id,
    staffRoleId: staffRole.id,
    logChannelId: logChannel.id,
  };
  saveData(store);

  await interaction.reply({
    content: `Ticket system configured.\n• Category: <#${category.id}>\n• Staff role: <@&${staffRole.id}>\n• Log channel: <#${logChannel.id}>\n\nUse \`/ticket panel\` in the channel where you want the create-ticket button.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

async function handleTicketPanel(interaction) {
  const cfg = getTicketConfig(interaction.guildId);
  if (!cfg) {
    return interaction.reply({ content: "Run `/ticket setup` first.", flags: MessageFlags.Ephemeral });
  }
  const categories = getGuildCategories(interaction.guildId);
  if (!categories.length) {
    return interaction.reply({
      content: "No menu options are set. Add some with `/ticket menu add` or run `/ticket menu reset`.",
      flags: MessageFlags.Ephemeral,
    });
  }
  const title = interaction.options.getString("title");
  const description = interaction.options.getString("description");
  await interaction.reply({ content: "Panel posted.", flags: MessageFlags.Ephemeral });
  await interaction.channel.send({
    embeds: [ticketPanelEmbed(categories, { title, description })],
    components: [ticketPanelRow(categories)],
  });
}

async function handleTicketMenuList(interaction) {
  const categories = getGuildCategories(interaction.guildId);
  const isCustom = Array.isArray(store.ticketMenus[interaction.guildId]) && store.ticketMenus[interaction.guildId].length;
  const lines = categories.length
    ? categories.map((c, i) => `${i + 1}. ${c.emoji} **${c.label}** — ${c.description}  \`(${c.value})\``).join("\n")
    : "No menu options set.";
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Ticket menu options${isCustom ? "" : " (defaults)"}`)
    .setDescription(lines)
    .setFooter({ text: "Add: /ticket menu add  •  Remove: /ticket menu remove  •  Clear: /ticket menu reset" });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleTicketMenuAdd(interaction) {
  const label = interaction.options.getString("label", true).trim();
  const description = (interaction.options.getString("description") || " ").trim().slice(0, 100);
  const emoji = (interaction.options.getString("emoji") || "🎫").trim();

  const current = Array.isArray(store.ticketMenus[interaction.guildId])
    ? [...store.ticketMenus[interaction.guildId]]
    : [];
  if (current.length >= 25) {
    return interaction.reply({ content: "You already have 25 menu options (Discord's max).", flags: MessageFlags.Ephemeral });
  }

  let value = slugify(label);
  let suffix = 2;
  while (current.some((c) => c.value === value)) {
    value = `${slugify(label)}-${suffix++}`;
  }

  current.push({ value, label: label.slice(0, 80), description, emoji });
  store.ticketMenus[interaction.guildId] = current;
  saveData(store);

  return interaction.reply({
    content: `Added **${emoji} ${label}** to the menu. Re-post the panel with \`/ticket panel\` so members see it.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleTicketMenuRemove(interaction) {
  const list = store.ticketMenus[interaction.guildId];
  if (!Array.isArray(list) || !list.length) {
    return interaction.reply({ content: "You haven't added any custom menu options yet. Add some with `/ticket menu add` first.", flags: MessageFlags.Ephemeral });
  }
  const number = interaction.options.getInteger("number", true);
  const idx = number - 1;
  if (idx < 0 || idx >= list.length) {
    return interaction.reply({
      content: `That number doesn't exist. You currently have **${list.length}** option${list.length === 1 ? "" : "s"} (use \`/ticket menu list\` to see them).`,
      flags: MessageFlags.Ephemeral,
    });
  }
  const removed = list.splice(idx, 1)[0];
  store.ticketMenus[interaction.guildId] = list;
  saveData(store);
  return interaction.reply({
    content: `Removed **${removed.emoji} ${removed.label}** (option #${number}) from the menu. Re-post the panel with \`/ticket panel\`.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleTicketMenuReset(interaction) {
  delete store.ticketMenus[interaction.guildId];
  saveData(store);
  return interaction.reply({
    content: "Menu cleared. The panel will now use the **default** options (Support / Report / Purchase / Other) until you add new ones with `/ticket menu add`.",
    flags: MessageFlags.Ephemeral,
  });
}

async function handleTicketCloseSlash(interaction) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.closed) {
    return interaction.reply({ content: "This isn't an open ticket channel.", flags: MessageFlags.Ephemeral });
  }
  const cfg = getTicketConfig(interaction.guildId);
  if (!(await isStaffMember(interaction.guild, interaction.member, cfg))) {
    return interaction.reply({ content: "Only staff can close tickets.", flags: MessageFlags.Ephemeral });
  }
  const reason = interaction.options.getString("reason") || null;
  await interaction.reply({ content: "Closing ticket and saving transcript..." });
  const result = await finalizeTicketClose(ticket, interaction.channel, interaction.user, reason);
  await notifyCloserOfLogIssue(interaction.user, ticket, result);
  setTimeout(() => interaction.channel.delete().catch(() => {}), 4000);
}

async function handleTicketAdd(interaction) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.closed) {
    return interaction.reply({ content: "This isn't an open ticket channel.", flags: MessageFlags.Ephemeral });
  }
  const cfg = getTicketConfig(interaction.guildId);
  if (!(await isStaffMember(interaction.guild, interaction.member, cfg))) {
    return interaction.reply({ content: "Only staff can add users.", flags: MessageFlags.Ephemeral });
  }
  const user = interaction.options.getUser("user", true);
  await interaction.channel.permissionOverwrites.edit(user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
  });
  await interaction.reply(`Added <@${user.id}> to the ticket.`);
}

async function handleTicketRename(interaction) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.closed) {
    return interaction.reply({ content: "This isn't an open ticket channel.", flags: MessageFlags.Ephemeral });
  }
  const cfg = getTicketConfig(interaction.guildId);
  if (!(await isStaffMember(interaction.guild, interaction.member, cfg))) {
    return interaction.reply({ content: "Only staff can rename tickets.", flags: MessageFlags.Ephemeral });
  }
  const raw = interaction.options.getString("name", true);
  const newName = slugify(raw);
  if (!newName) {
    return interaction.reply({ content: "That name has no usable characters. Try letters, numbers, or dashes.", flags: MessageFlags.Ephemeral });
  }
  const oldName = interaction.channel.name;
  await interaction.deferReply();
  try {
    await interaction.channel.setName(newName, `Renamed by ${interaction.user.tag}`);
    await interaction.editReply(`Channel renamed: \`${oldName}\` → \`${interaction.channel.name}\``);
  } catch (err) {
    console.error("Ticket rename failed:", err);
    await interaction.editReply(`Couldn't rename the channel: ${err.message}\n(Discord limits channel renames to **2 times every 10 minutes**.)`);
  }
}

async function handleTicketRemove(interaction) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.closed) {
    return interaction.reply({ content: "This isn't an open ticket channel.", flags: MessageFlags.Ephemeral });
  }
  const cfg = getTicketConfig(interaction.guildId);
  if (!(await isStaffMember(interaction.guild, interaction.member, cfg))) {
    return interaction.reply({ content: "Only staff can remove users.", flags: MessageFlags.Ephemeral });
  }
  const user = interaction.options.getUser("user", true);
  if (user.id === ticket.userId) {
    return interaction.reply({ content: "You can't remove the ticket owner.", flags: MessageFlags.Ephemeral });
  }
  await interaction.channel.permissionOverwrites.delete(user.id).catch(() => {});
  await interaction.reply(`Removed <@${user.id}> from the ticket.`);
}

async function handleTicketCreateSelect(interaction) {
  const cfg = getTicketConfig(interaction.guildId);
  if (!cfg) {
    return interaction.reply({ content: "Tickets aren't configured. Ask an admin to run `/ticket setup`.", flags: MessageFlags.Ephemeral });
  }
  const existing = getOpenTicketByUser(interaction.guildId, interaction.user.id);
  if (existing) {
    return interaction.reply({
      content: `You already have an open ticket: <#${existing.channelId}>`,
      flags: MessageFlags.Ephemeral,
    });
  }
  const categoryValue = interaction.values?.[0] || getGuildCategories(interaction.guildId)[0]?.value;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const { ticket, channel } = await createTicketChannel(interaction, cfg, categoryValue);
    const catLabel = getCategoryFor(interaction.guildId, categoryValue).label;
    await interaction.editReply(`Ticket created: <#${channel.id}> (Ticket #${ticket.id} • ${catLabel})`);
  } catch (err) {
    console.error("Ticket creation failed:", err);
    await interaction.editReply(`Failed to create ticket: ${err.message}`);
  }
}

async function handleTicketStats(interaction) {
  const guildTickets = store.tickets.filter((t) => t.guildId === interaction.guildId);
  const total = guildTickets.length;
  const open = guildTickets.filter((t) => !t.closed).length;
  const closed = guildTickets.filter((t) => t.closed).length;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const last7d = guildTickets.filter((t) => t.createdAt >= sevenDaysAgo).length;

  const closedWithTimes = guildTickets.filter((t) => t.closed && t.closedAt);
  let avgResMs = 0;
  if (closedWithTimes.length) {
    avgResMs =
      closedWithTimes.reduce((sum, t) => sum + (t.closedAt - t.createdAt), 0) /
      closedWithTimes.length;
  }
  const avgResStr = closedWithTimes.length ? formatUptime(avgResMs) : "—";

  const catCounts = {};
  for (const t of guildTickets) {
    const v = t.category || "support";
    catCounts[v] = (catCounts[v] || 0) + 1;
  }
  const guildCats = getGuildCategories(interaction.guildId);
  const knownValues = new Set(guildCats.map((c) => c.value));
  const knownLines = guildCats.map((c) => {
    const n = catCounts[c.value] || 0;
    return `${c.emoji} **${c.label}** — ${n}`;
  });
  const legacyLines = Object.entries(catCounts)
    .filter(([v]) => !knownValues.has(v))
    .map(([v, n]) => `• \`${v}\` — ${n}`);
  const catLines = [...knownLines, ...legacyLines].join("\n") || "—";

  const claimerCounts = {};
  for (const t of guildTickets) {
    if (t.claimedBy) claimerCounts[t.claimedBy] = (claimerCounts[t.claimedBy] || 0) + 1;
  }
  const topClaimers = Object.entries(claimerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([uid, n], i) => `${i + 1}. <@${uid}> — ${n}`)
    .join("\n") || "No claims yet.";

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Ticket Statistics")
    .addFields(
      { name: "Total tickets", value: String(total), inline: true },
      { name: "Open", value: String(open), inline: true },
      { name: "Closed", value: String(closed), inline: true },
      { name: "Last 7 days", value: String(last7d), inline: true },
      { name: "Avg resolution time", value: avgResStr, inline: true },
      { name: "Claimed (closed)", value: String(closedWithTimes.filter((t) => t.claimedBy).length), inline: true },
      { name: "By category", value: catLines || "—", inline: false },
      { name: "Top claimers", value: topClaimers, inline: false },
    )
    .setFooter({ text: `Server: ${interaction.guild.name}` })
    .setTimestamp();
  return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function handleTicketCloseButton(interaction) {
  const ticket = getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.closed) {
    return interaction.reply({ content: "This ticket is no longer open.", flags: MessageFlags.Ephemeral });
  }
  const cfg = getTicketConfig(interaction.guildId);
  if (!(await isStaffMember(interaction.guild, interaction.member, cfg))) {
    return interaction.reply({ content: "Only staff can close tickets.", flags: MessageFlags.Ephemeral });
  }
  await interaction.reply({
    content: "Are you sure you want to close this ticket?",
    components: [ticketConfirmCloseRow(ticket.id)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleTicketCloseConfirm(interaction, ticketId) {
  const ticket = store.tickets.find((t) => t.id === Number(ticketId));
  if (!ticket || ticket.closed) {
    return interaction.update({ content: "Ticket already closed.", components: [] });
  }
  const cfg = getTicketConfig(interaction.guildId);
  if (!(await isStaffMember(interaction.guild, interaction.member, cfg))) {
    return interaction.reply({ content: "Only staff can close tickets.", flags: MessageFlags.Ephemeral });
  }
  await interaction.update({ content: "Closing ticket and saving transcript...", components: [] });
  const channel = await client.channels.fetch(ticket.channelId);
  const result = await finalizeTicketClose(ticket, channel, interaction.user, null);
  await notifyCloserOfLogIssue(interaction.user, ticket, result);
  setTimeout(() => channel.delete().catch(() => {}), 4000);
}

async function handleTicketCloseCancel(interaction) {
  await interaction.update({ content: "Close cancelled.", components: [] });
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

const ticketCommand = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Ticket system")
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName("setup")
      .setDescription("Configure the ticket system for this server")
      .addChannelOption((o) =>
        o.setName("category").setDescription("Category where ticket channels are created").setRequired(true),
      )
      .addRoleOption((o) =>
        o.setName("staff_role").setDescription("Role that can see and manage tickets").setRequired(true),
      )
      .addChannelOption((o) =>
        o.setName("log_channel").setDescription("Channel where transcripts are sent").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("panel")
      .setDescription("Post the ticket creation panel in the current channel")
      .addStringOption((o) => o.setName("title").setDescription("Panel title").setMaxLength(100))
      .addStringOption((o) => o.setName("description").setDescription("Panel description").setMaxLength(500)),
  )
  .addSubcommand((s) =>
    s
      .setName("close")
      .setDescription("Close the current ticket")
      .addStringOption((o) => o.setName("reason").setDescription("Optional reason").setMaxLength(500)),
  )
  .addSubcommand((s) =>
    s
      .setName("add")
      .setDescription("Add a user to the current ticket")
      .addUserOption((o) => o.setName("user").setDescription("User to add").setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Remove a user from the current ticket")
      .addUserOption((o) => o.setName("user").setDescription("User to remove").setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("rename")
      .setDescription("Rename the current ticket channel (staff only)")
      .addStringOption((o) =>
        o
          .setName("name")
          .setDescription("New channel name (letters, numbers, dashes)")
          .setRequired(true)
          .setMaxLength(80),
      ),
  )
  .addSubcommand((s) =>
    s.setName("stats").setDescription("Show ticket statistics for this server"),
  )
  .addSubcommandGroup((g) =>
    g
      .setName("menu")
      .setDescription("Manage the ticket panel menu options")
      .addSubcommand((s) => s.setName("list").setDescription("List the current menu options"))
      .addSubcommand((s) =>
        s
          .setName("add")
          .setDescription("Add a new option to the ticket menu")
          .addStringOption((o) => o.setName("label").setDescription("Option name shown in the menu").setRequired(true).setMaxLength(80))
          .addStringOption((o) => o.setName("description").setDescription("Short description below the label").setMaxLength(100))
          .addStringOption((o) => o.setName("emoji").setDescription("A single emoji (default: 🎫)")),
      )
      .addSubcommand((s) =>
        s
          .setName("remove")
          .setDescription("Remove a menu option by its number")
          .addIntegerOption((o) =>
            o
              .setName("number")
              .setDescription("The option's number from /ticket menu list (1, 2, 3, …)")
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(25),
          ),
      )
      .addSubcommand((s) => s.setName("reset").setDescription("Reset the menu back to defaults")),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);

const statusCommand = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Owner only: see bot health and uptime")
  .setDMPermission(true);

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: [
      checkCommand.toJSON(),
      giveawayCommand.toJSON(),
      verifyCommand.toJSON(),
      cancelCommand.toJSON(),
      ticketCommand.toJSON(),
      statusCommand.toJSON(),
    ],
  });
  console.log("Slash commands registered globally.");
}

async function handleStatus(interaction) {
  if (!ownerId || interaction.user.id !== ownerId) {
    return interaction.reply({
      content: "This command is restricted to the bot owner.",
      flags: MessageFlags.Ephemeral,
    });
  }
  const uptimeMs = Date.now() - START_TIME;
  const mem = process.memoryUsage();
  const memMb = (mem.rss / 1024 / 1024).toFixed(1);
  const ping = Math.round(client.ws.ping);
  const guilds = client.guilds.cache.size;
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Bot Status — Online")
    .addFields(
      { name: "Uptime", value: formatUptime(uptimeMs), inline: true },
      { name: "Started", value: `<t:${Math.floor(START_TIME / 1000)}:R>`, inline: true },
      { name: "Gateway ping", value: `${ping} ms`, inline: true },
      { name: "Servers", value: String(guilds), inline: true },
      { name: "Memory", value: `${memMb} MB`, inline: true },
      { name: "Node", value: process.version, inline: true },
    )
    .setFooter({ text: "If this command stops responding, the bot is offline." })
    .setTimestamp();
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
      if (interaction.commandName === "status") return handleStatus(interaction);
      if (interaction.commandName === "ticket") {
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();
        if (group === "menu") {
          if (sub === "list") return handleTicketMenuList(interaction);
          if (sub === "add") return handleTicketMenuAdd(interaction);
          if (sub === "remove") return handleTicketMenuRemove(interaction);
          if (sub === "reset") return handleTicketMenuReset(interaction);
        }
        if (sub === "setup") return handleTicketSetup(interaction);
        if (sub === "panel") return handleTicketPanel(interaction);
        if (sub === "close") return handleTicketCloseSlash(interaction);
        if (sub === "add") return handleTicketAdd(interaction);
        if (sub === "remove") return handleTicketRemove(interaction);
        if (sub === "rename") return handleTicketRename(interaction);
        if (sub === "stats") return handleTicketStats(interaction);
      }
    } else if (interaction.isStringSelectMenu()) {
      const [ns, action] = interaction.customId.split(":");
      if (ns === "ticket" && action === "create") return handleTicketCreateSelect(interaction);
    } else if (interaction.isButton()) {
      const [ns, action, id] = interaction.customId.split(":");
      if (ns === "giveaway" && action === "enter") return handleEnterButton(interaction, id);
      if (ns === "ticket") {
        if (action === "close") return handleTicketCloseButton(interaction);
        if (action === "close_confirm") return handleTicketCloseConfirm(interaction, id);
        if (action === "close_cancel") return handleTicketCloseCancel(interaction);
        if (action === "claim") return handleTicketClaimButton(interaction);
      }
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
    const app = await client.application.fetch();
    ownerId = app.owner?.ownerId || app.owner?.id || null;
    if (app.owner?.members) {
      const first = app.owner.members.first();
      if (first) ownerId = first.id;
    }
    console.log(`Owner ID: ${ownerId}`);
  } catch (err) {
    console.error("Failed to fetch application owner:", err.message);
  }
  try {
    await registerCommands();
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }
  for (const g of store.giveaways) {
    if (!g.ended) scheduleGiveaway(g);
  }
  await dmOwner({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅ Bot is online")
        .setDescription(
          `Logged in as **${client.user.tag}**.\nUse \`/status\` any time to check health.`,
        )
        .addFields({ name: "Started", value: `<t:${Math.floor(START_TIME / 1000)}:F>`, inline: true })
        .setTimestamp(),
    ],
  });
});

let shuttingDown = false;
async function notifyShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, notifying owner...`);
  try {
    await dmOwner({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("⚠️ Bot is going offline")
          .setDescription(
            `Signal: \`${signal}\`\nUptime was **${formatUptime(Date.now() - START_TIME)}**.\nRestart the workflow (or redeploy) to bring it back online.`,
          )
          .setTimestamp(),
      ],
    });
  } catch {}
  try {
    client.destroy();
  } catch {}
  process.exit(0);
}
process.on("SIGINT", () => notifyShutdown("SIGINT"));
process.on("SIGTERM", () => notifyShutdown("SIGTERM"));

// ---------- Keep-alive web server (for Render / UptimeRobot) ----------
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  const status = client.user
    ? {
        status: "online",
        bot: client.user.tag,
        uptime: formatUptime(Date.now() - START_TIME),
        servers: client.guilds.cache.size,
        ping_ms: Math.round(client.ws.ping),
      }
    : { status: "starting" };
  res.json(status);
});

app.get("/health", (req, res) => {
  if (client.user) res.status(200).send("OK");
  else res.status(503).send("starting");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Keep-alive web server listening on port ${PORT}`);
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
