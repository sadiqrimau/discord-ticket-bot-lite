require('dotenv').config();
const {
  Client, GatewayIntentBits, Events, REST, Routes, MessageFlags, SlashCommandBuilder,
  PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder
} = require('discord.js');
const db = require('./db');
const { buildTranscript } = require('./transcript');

const REQUIRED = ['TOKEN', 'CLIENT_ID', 'GUILD_ID', 'STAFF_ROLE_ID', 'CATEGORY_ID', 'LOG_CHANNEL_ID'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`);
  process.exit(1);
}
const { TOKEN, CLIENT_ID, GUILD_ID, STAFF_ROLE_ID, CATEGORY_ID, LOG_CHANNEL_ID } = process.env;
const EPH = { flags: MessageFlags.Ephemeral };

// MessageContent is a privileged intent: enable it in the Developer Portal so transcripts include message text.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const commands = [
  new SlashCommandBuilder().setName('ticketpanel').setDescription('Send the ticket panel to this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('ticketstats').setDescription('Show ticket statistics')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

const isStaff = member => member.roles.cache.has(STAFF_ROLE_ID);

const ticketButtons = claimedBy => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('ticket_claim')
    .setLabel(claimedBy ? `Claimed by ${claimedBy}` : 'Claim')
    .setStyle(claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(Boolean(claimedBy)),
  new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger)
);

client.once(Events.ClientReady, async () => {
  await new REST().setToken(TOKEN).put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log(`Ready as ${client.user.tag}`);
});

async function openTicket(i) {
  await i.deferReply(EPH); // acknowledge within Discord's 3-second limit
  const existing = db.openByOwner(i.user.id);
  if (existing) return i.editReply({ content: `You already have an open ticket: <#${existing.channel_id}>` });

  const see = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];
  let channel;
  try {
    channel = await i.guild.channels.create({
      name: `ticket-${i.user.username}`,
      type: ChannelType.GuildText,
      parent: CATEGORY_ID,
      permissionOverwrites: [
        { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        // The bot needs its own overwrite: hiding the channel from @everyone also hides it from the bot.
        { id: client.user.id, allow: [...see, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageChannels] },
        { id: i.user.id, allow: see },
        { id: STAFF_ROLE_ID, allow: see }
      ]
    });
    const id = db.create(channel.id, i.user.id);

    await channel.send({
      content: `${i.user} <@&${STAFF_ROLE_ID}>`,
      embeds: [new EmbedBuilder().setTitle(`Ticket #${String(id).padStart(4, '0')}`)
        .setDescription('Describe your issue. Staff will reply soon.').setColor(0x5865f2)],
      components: [ticketButtons()]
    });
  } catch (err) {
    // Roll back so a failed setup never leaves a ghost ticket that blocks the user.
    if (channel) { db.close(channel.id); await channel.delete().catch(() => {}); }
    throw err;
  }
  return i.editReply({ content: `Ticket created: ${channel}` });
}

async function claimTicket(i, ticket) {
  if (ticket.claimed_by) return i.reply({ content: `Already claimed by <@${ticket.claimed_by}>.`, ...EPH });
  db.claim(i.channel.id, i.user.id);
  await i.update({ components: [ticketButtons(i.user.username)] });
  return i.followUp(`${i.user} has claimed this ticket.`);
}

const closing = new Set(); // guards against double-clicks while a transcript is being built

async function closeTicket(i, ticket) {
  if (ticket.status === 'closed' || closing.has(i.channel.id))
    return i.reply({ content: 'This ticket is already closing or closed.', ...EPH });
  closing.add(i.channel.id);
  try {
    await i.reply({ content: 'Saving transcript...', ...EPH }); // private, so it isn't part of the transcript
    const file = await buildTranscript(i.channel, ticket);

    try {
      const log = await i.guild.channels.fetch(LOG_CHANNEL_ID);
      await log.send({
        content: `Ticket \`${i.channel.name}\` closed by ${i.user}. Owner: <@${ticket.owner_id}>`,
        files: [file]
      });
    } catch (err) {
      console.error('Could not post to the log channel:', err.message);
      // Keep the ticket open and hand staff the transcript here so nothing is lost.
      await i.channel.send({
        content: '⚠️ I could not post to the log channel. Give me View Channel, Send Messages and Attach Files there, then press Close again. The transcript is attached below.',
        files: [file]
      });
      return;
    }

    db.close(i.channel.id);
    const owner = await client.users.fetch(ticket.owner_id).catch(() => null);
    if (owner) await owner.send({ content: 'Here is the transcript of your ticket:', files: [file] }).catch(() => {}); // DMs may be closed

    await i.channel.send('Transcript saved. Closing in 5 seconds...');
    setTimeout(() => i.channel.delete().catch(() => {}), 5000);
  } finally {
    closing.delete(i.channel.id);
  }
}

client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isChatInputCommand()) {
      if (i.commandName === 'ticketpanel') {
        await i.deferReply(EPH);
        await i.channel.send({
          embeds: [new EmbedBuilder().setTitle('Support Tickets')
            .setDescription('Click the button below to open a ticket.').setColor(0x5865f2)],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_open').setLabel('Open Ticket').setStyle(ButtonStyle.Primary))]
        });
        return i.editReply({ content: 'Panel sent.' });
      }
      if (i.commandName === 'ticketstats') {
        const s = db.stats();
        return i.reply({ content: `Total: ${s.total} | Open: ${s.open} | Closed: ${s.closed}`, ...EPH });
      }
      return;
    }

    if (!i.isButton()) return;
    if (i.customId === 'ticket_open') return await openTicket(i);

    if (i.customId === 'ticket_claim' || i.customId === 'ticket_close') {
      if (!isStaff(i.member)) return i.reply({ content: 'Only staff can do that.', ...EPH });
      const ticket = db.byChannel(i.channel.id);
      if (!ticket) return i.reply({ content: 'Ticket not found in the database.', ...EPH });
      return await (i.customId === 'ticket_claim' ? claimTicket(i, ticket) : closeTicket(i, ticket));
    }
  } catch (err) {
    console.error(err);
    const msg = { content: 'Something went wrong. Please try again.', ...EPH };
    if (i.replied || i.deferred) i.followUp(msg).catch(() => {});
    else i.reply(msg).catch(() => {});
  }
});

// If a ticket channel is deleted manually, mark it closed so the user can open a new one.
client.on(Events.ChannelDelete, ch => db.close(ch.id));

client.on(Events.Error, e => console.error('Client error:', e));
process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));
client.login(TOKEN);
