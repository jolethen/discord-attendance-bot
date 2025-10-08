const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const cron = require('node-cron');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const DATA_FILE = './attendance.json';

let data = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : { 
  staff: [], 
  attendance: {},
  attendanceChannelId: process.env.ATTENDANCE_CHANNEL_ID || null,
  summaryChannelId: process.env.SUMMARY_CHANNEL_ID || null
};

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const commands = [
  new SlashCommandBuilder()
    .setName('addstaff')
    .setDescription('Add a staff member to the attendance list')
    .addUserOption(option => 
      option.setName('user')
        .setDescription('The user to add')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('removestaff')
    .setDescription('Remove a staff member from the attendance list')
    .addUserOption(option => 
      option.setName('user')
        .setDescription('The user to remove')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('setattendancechannel')
    .setDescription('Set the channel for daily attendance checks')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to use (leave empty for current channel)')
        .setRequired(false)),
  new SlashCommandBuilder()
    .setName('setsummarychannel')
    .setDescription('Set the channel for weekly summary reports')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to use (leave empty for current channel)')
        .setRequired(false)),
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: "❌ You don't have permission to use this command.", ephemeral: true });
  }

  if (interaction.commandName === 'addstaff') {
    const user = interaction.options.getUser('user');
    if (!data.staff.includes(user.id)) {
      data.staff.push(user.id);
      saveData();
      await interaction.reply(`✅ Added ${user.username} to the staff list.`);
    } else {
      await interaction.reply("⚠️ That user is already on the staff list.");
    }
  }

  if (interaction.commandName === 'removestaff') {
    const user = interaction.options.getUser('user');
    data.staff = data.staff.filter(id => id !== user.id);
    saveData();
    await interaction.reply(`❌ Removed ${user.username} from the staff list.`);
  }

  if (interaction.commandName === 'setattendancechannel') {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    data.attendanceChannelId = channel.id;
    saveData();
    await interaction.reply(`✅ Attendance channel set to <#${channel.id}>`);
  }

  if (interaction.commandName === 'setsummarychannel') {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    data.summaryChannelId = channel.id;
    saveData();
    await interaction.reply(`✅ Summary channel set to <#${channel.id}>`);
  }
});

cron.schedule('0 9 * * *', async () => {
  if (!data.attendanceChannelId) return;
  const channel = await client.channels.fetch(data.attendanceChannelId);
  if (!channel) return;

  const msg = await channel.send({
    content: `🕒 **Daily Attendance Check!** Staff please react with ✅ within 12 hours.`,
  });

  await msg.react('✅');

  const collector = msg.createReactionCollector({
    time: 12 * 60 * 60 * 1000,
  });

  collector.on('collect', (reaction, user) => {
    if (reaction.emoji.name === '✅' && data.staff.includes(user.id)) {
      const today = new Date().toISOString().split('T')[0];
      if (!data.attendance[today]) data.attendance[today] = [];
      if (!data.attendance[today].includes(user.id)) {
        data.attendance[today].push(user.id);
        saveData();
      }
    }
  });
});

cron.schedule('0 10 * * 0', async () => {
  if (!data.summaryChannelId) return;
  const channel = await client.channels.fetch(data.summaryChannelId);
  if (!channel) return;

  const past7days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().split('T')[0];
  });

  const counts = {};
  for (const day of past7days) {
    if (data.attendance[day]) {
      for (const id of data.attendance[day]) {
        counts[id] = (counts[id] || 0) + 1;
      }
    }
  }

  const lines = data.staff.map(id => {
    const member = client.users.cache.get(id);
    const name = member ? member.username : `Unknown (${id})`;
    const count = counts[id] || 0;
    return `**${name}** — ${count}/7 days active`;
  });

  const embed = new EmbedBuilder()
    .setTitle("📅 Weekly Staff Attendance Report")
    .setDescription(lines.join('\n') || "No data yet.")
    .setColor('Blue')
    .setTimestamp();

  await channel.send({ embeds: [embed] });
});

client.login(TOKEN);
