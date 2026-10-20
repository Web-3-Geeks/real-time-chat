/**
 * Seeds demo users, private chats and groups for manual testing.
 *
 *   npm run seed            -> create demo data (refuses if it already exists)
 *   npm run seed -- --reset -> delete previous demo data first, then re-create
 *
 * Only ever touches users with an @demo.com email and conversations whose
 * members are all demo users, so it's safe to run against a database that
 * also holds real accounts. Every demo user's password is "Password123".
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const ConversationMember = require('../models/ConversationMember');
const Message = require('../models/Message');

const DEMO_DOMAIN = '@demo.com';
const PASSWORD = 'Password123';

const NAMES = [
  'Anna Johnson',
  'Brian Carter',
  'Clara Smith',
  'David Brown',
  'Emily Davis',
  'Henry Moore',
  'Isabella Taylor',
  'Rachel Green',
  'Steve Evans',
];

const emailFor = (name) => `${name.toLowerCase().replace(/\s+/g, '.')}${DEMO_DOMAIN}`;

// Minutes before "now" — keeps the demo history looking recent.
const ago = (minutes) => new Date(Date.now() - minutes * 60000);

async function removeDemoData() {
  const demoUsers = await User.find({ email: { $regex: `${DEMO_DOMAIN.replace('.', '\\.')}$` } }).select('_id');
  const demoIds = demoUsers.map((u) => u._id.toString());
  if (demoIds.length === 0) return 0;

  // A conversation is demo data only if every member is a demo user.
  const convIds = await ConversationMember.find({ userId: { $in: demoIds } }).distinct('conversationId');
  const demoConvIds = [];
  for (const convId of convIds) {
    const memberIds = await ConversationMember.find({ conversationId: convId }).distinct('userId');
    if (memberIds.every((id) => demoIds.includes(id.toString()))) demoConvIds.push(convId);
  }

  await Message.deleteMany({ conversationId: { $in: demoConvIds } });
  await ConversationMember.deleteMany({ conversationId: { $in: demoConvIds } });
  await Conversation.deleteMany({ _id: { $in: demoConvIds } });
  // Memberships of demo users in real conversations are left alone on
  // purpose, but the user rows themselves are removed.
  await User.deleteMany({ _id: { $in: demoIds } });
  return demoIds.length;
}

async function seed() {
  const hash = await bcrypt.hash(PASSWORD, await bcrypt.genSalt(10));
  const users = {};
  for (const name of NAMES) {
    const user = await User.create({ name, email: emailFor(name), password: hash });
    users[name.split(' ')[0]] = user;
  }
  const id = (first) => users[first]._id;

  // Writes one message with an explicit timestamp. `readers` have read it;
  // everyone online is treated as delivered.
  const say = async (conversation, sender, content, minutesAgo, extra = {}) => {
    const createdAt = ago(minutesAgo);
    const memberIds = conversation.memberFirstNames.map(id);
    const others = memberIds.filter((m) => !m.equals(id(sender)));
    const readers = (extra.readBy || conversation.memberFirstNames.filter((n) => n !== sender)).map(id);
    const [message] = await Message.insertMany(
      [
        {
          conversationId: conversation._id,
          senderId: id(sender),
          content,
          messageType: extra.messageType || 'text',
          replyTo: extra.replyTo,
          reactions: (extra.reactions || []).map(([first, emoji]) => ({ userId: id(first), emoji })),
          deliveredTo: others,
          readBy: readers,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      { timestamps: false }
    );
    await Conversation.updateOne({ _id: conversation._id }, { $set: { updatedAt: createdAt } }, { timestamps: false });
    return message;
  };

  const privateChat = async (a, b) => {
    const conversation = await Conversation.create({
      type: 'private',
      pairKey: [id(a).toString(), id(b).toString()].sort().join('_'),
    });
    await ConversationMember.create([
      { conversationId: conversation._id, userId: id(a) },
      { conversationId: conversation._id, userId: id(b) },
    ]);
    conversation.memberFirstNames = [a, b];
    return conversation;
  };

  const group = async (name, admin, members, minutesAgo) => {
    const conversation = await Conversation.create({ type: 'group', name });
    await ConversationMember.create(
      [admin, ...members].map((first, i) => ({
        conversationId: conversation._id,
        userId: id(first),
        role: i === 0 ? 'admin' : 'member',
      }))
    );
    conversation.memberFirstNames = [admin, ...members];
    await say(conversation, admin, `${users[admin].name} created the group "${name}"`, minutesAgo, {
      messageType: 'system',
    });
    return conversation;
  };

  // --- Private chats --------------------------------------------------------
  const annaBrian = await privateChat('Anna', 'Brian');
  await say(annaBrian, 'Brian', 'Hey Anna! Are we still on for the client call tomorrow?', 300);
  const callMsg = await say(annaBrian, 'Anna', 'Yes! 10 AM works for me. I will share the slides tonight.', 295);
  await say(annaBrian, 'Brian', 'Perfect, thanks!', 290, { replyTo: callMsg._id, reactions: [['Anna', '👍']] });
  // Last two unread for Anna.
  await say(annaBrian, 'Brian', 'Quick question: can you help me figure out the budget sheet?', 20, { readBy: [] });
  await say(annaBrian, 'Brian', "I've been stuck on the totals for an hour 😅", 19, { readBy: [] });

  const annaClara = await privateChat('Anna', 'Clara');
  await say(annaClara, 'Clara', "OMG, you won't believe what just happened at the office!", 90);
  await say(annaClara, 'Anna', 'Tell me everything 😂', 88, { reactions: [['Clara', '😂']] });
  await say(annaClara, 'Clara', 'The coffee machine finally got fixed ☕', 85);

  const brianDavid = await privateChat('Brian', 'David');
  await say(brianDavid, 'David', 'Do you have a minute to talk about the trip?', 60);
  await say(brianDavid, 'Brian', 'Sure, call me in 5.', 58);

  const annaRachel = await privateChat('Anna', 'Rachel');
  await say(annaRachel, 'Rachel', 'Can you double-check this report for me before I send it?', 2900);

  // --- Groups ---------------------------------------------------------------
  const design = await group('Design Team', 'Anna', ['Brian', 'Clara', 'Emily'], 1500);
  await say(design, 'Anna', 'Welcome everyone! This is where we share mockups and feedback.', 1495);
  const mockup = await say(design, 'Emily', 'I just uploaded the new landing page mockups to Figma.', 240, {
    reactions: [['Anna', '❤️'], ['Brian', '❤️'], ['Clara', '👍']],
  });
  await say(design, 'Clara', 'These look amazing! Love the new color palette.', 235, { replyTo: mockup._id });
  await say(design, 'Brian', 'Can we make the CTA button a bit bigger on mobile?', 45);
  await say(design, 'Emily', 'Good idea, I will update it this afternoon.', 40, { readBy: ['Brian', 'Clara'] });

  const trip = await group('Weekend Trip', 'Brian', ['Anna', 'David', 'Henry', 'Isabella'], 3000);
  await say(trip, 'Brian', 'Who is in for hiking on Saturday? 🏔️', 180, {
    reactions: [['Anna', '👍'], ['David', '👍'], ['Henry', '👍'], ['Isabella', '🙏']],
  });
  await say(trip, 'Isabella', 'Count me in! I can bring snacks.', 175);
  await say(trip, 'Henry', 'Just checking in — how is everything going with the car booking?', 30, {
    readBy: ['Brian', 'David', 'Isabella'],
  });

  const marketing = await group('Marketing Squad', 'Clara', ['Emily', 'Steve', 'Isabella', 'Henry'], 4000);
  await say(marketing, 'Steve', "I've been meaning to ask — how is the campaign performing?", 600);
  await say(marketing, 'Clara', 'Click-through rate is up 18% this week 🚀', 590, {
    reactions: [['Steve', '😮'], ['Emily', '❤️']],
  });

  return { users: Object.keys(users).length, conversations: 7 };
}

(async () => {
  const reset = process.argv.includes('--reset');
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set (check backend/.env).');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const existing = await User.countDocuments({ email: { $regex: `${DEMO_DOMAIN.replace('.', '\\.')}$` } });
    if (existing > 0 && !reset) {
      console.log(`Demo data already exists (${existing} demo users). Run with --reset to re-create it.`);
      return;
    }
    if (reset) console.log(`Removed ${await removeDemoData()} demo users and their conversations.`);

    const result = await seed();
    console.log(`Seeded ${result.users} demo users and ${result.conversations} conversations.`);
    console.log(`Log in as e.g. ${emailFor(NAMES[0])} / ${PASSWORD}`);
  } finally {
    await mongoose.disconnect();
  }
})().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
