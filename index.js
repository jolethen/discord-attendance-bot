const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
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

client.on('messageCreate', async (msg) => {
  if (!msg.content.startsWith('/') || msg.author.bot) return;

  const args = msg.content.slice(1).split(' ');
  const command = args.shift();

  if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return msg.reply("❌ You don't have permission to use this command.");
  }

  if (command === 'addstaff') {
    const user = msg.mentions.users.first();
    if (!user) return msg.reply("❌ Please mention a user to add.");
    if (!data.staff.includes(user.id)) {
      data.staff.push(user.id);
      saveData();
      msg.reply(`✅ Added ${user.username} to the staff list.`);
    } else msg.reply("⚠️ That user is already on the staff list.");
  }

  if (command === 'removestaff') {
    const user = msg.mentions.users.first();
    if (!user) return msg.reply("❌ Please mention a user to remove.");
    data.staff = data.staff.filter(id => id !== user.id);
    saveData();
    msg.reply(`❌ Removed ${user.username} from the staff list.`);
  }

  if (command === 'setattendancechannel') {
    const channelId = args[0] || msg.channel.id;
    data.attendanceChannelId = channelId;
    saveData();
    msg.reply(`✅ Attendance channel set to <#${channelId}>`);
  }

  if (command === 'setsummarychannel') {
    const channelId = args[0] || msg.channel.id;
    data.summaryChannelId = channelId;
    saveData();
    msg.reply(`✅ Summary channel set to <#${channelId}>`);
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

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
