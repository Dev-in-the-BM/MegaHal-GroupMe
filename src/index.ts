import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { MegaHAL } from './megahal/megahal';
// Note: personalities are now lazy-loaded, no need to import all of them

// Vercel Node.js runtime - use process.env instead of Bindings
export interface GroupConfig {
	personality: string;
	learning: 'on' | 'off';
	prefix: string | 'none';
}

// In-memory storage for Vercel (will be reset on cold starts)
// For production, use Vercel KV (Upstash Redis) or similar
const brainStore = new Map<string, Uint8Array>();
const configStore = new Map<string, GroupConfig>();

export const getGroupConfig = async (_kv: any, groupId: string): Promise<GroupConfig> => {
	const config = configStore.get(`config:${groupId}`) as GroupConfig | undefined;
	return (
		config || {
			personality: 'default',
			learning: 'on',
			prefix: '$',
		}
	);
};

export const saveGroupConfig = async (_kv: any, groupId: string, config: GroupConfig): Promise<void> => {
	configStore.set(`config:${groupId}`, config);
};

export const getBrain = async (_kv: any, groupId: string, personality: string): Promise<Uint8Array | null> => {
	return brainStore.get(`brain:${groupId}:${personality}`) || null;
};

export const saveBrain = async (_kv: any, groupId: string, personality: string, brain: Uint8Array): Promise<void> => {
	brainStore.set(`brain:${groupId}:${personality}`, brain);
};

const app = new Hono();

app.get('/', (c) => c.text('MegaHAL Bot is running on Vercel!'));

// GroupMe Message Payload
export interface GroupMeMessage {
	id: string;
	source_guid: string;
	created_at: number;
	user_id: string;
	group_id: string;
	name: string;
	avatar_url: string;
	text: string | null;
	system: boolean;
	favorited_by: string[];
	attachments: any[];
	sender_type: 'user' | 'bot' | 'system';
}

app.post('/', async (c) => {
	const body = await c.req.json<GroupMeMessage>();
	console.log(`Received message from ${body.name}: ${body.text}`); // LOG 1

	// Phase 3: Anti-Loop
	if (body.sender_type === 'bot' || body.sender_type === 'system') {
		console.log("Ignoring bot/system message");
		return c.text('Ignored bot/system message');
	}

	const groupId = body.group_id;
	const botId = process.env[`BOT_ID_${groupId}`];
	console.log(`Group ID: ${groupId}, Bot ID found: ${!!botId}`); // LOG 2

	// Ignore if no bot_id is configured for this group
	if (!botId) {
		return c.text('Group not configured');
	}

	const ownerUserId = process.env.OWNER_USER_ID || '';

	// Phase 3: Load config
	const config = await getGroupConfig(null, groupId);
	console.log(`Prefix expected: ${config.prefix}`); // LOG 3

	// Phase 4 command interception hook placeholder
	if (body.text?.startsWith('!') && body.user_id === ownerUserId) {
		return await handleAdminCommand(c, body, config, botId);
	}

	// Prefix Stripping
	let text = body.text || '';
	if (config.prefix !== 'none') {
		if (!text.startsWith(config.prefix)) {
			return c.text('Message ignored, missing prefix');
		}
		text = text.slice(config.prefix.length).trim();
	}

	if (!text) {
		return c.text('Empty message after prefix');
	}

	// MegaHAL Processing - Instantiate WITHOUT auto-training
	const hal = new MegaHAL(config.personality);
	// Disable learning during main request loop to avoid Markov CPU drain
	hal.learning = false;

	// Try to load brain from storage first!
	const brainData = await getBrain(null, groupId, config.personality);
	if (brainData) {
		hal.load(brainData); // Fast binary load (Takes < 1ms)
	} else {
		// ONLY train from scratch if the brain doesn't exist in storage yet
		await hal.become(config.personality);
	}

	const reply = hal.reply(text);

	// POST REPLY FIRST (Early Reply pattern for serverless)
	// This responds to GroupMe quickly, before the heavy save operation
	if (reply) {
		fetch('https://api.groupme.com/v3/bots/post', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				bot_id: botId,
				text: reply,
			}),
		}).catch((err) => console.error('Failed to post reply:', err));
	}

	// Learning and save - run after reply is sent
	// Vercel Node.js has 300s timeout, so we can await this directly
	try {
		// Enable learning for the save operation
		hal.learning = config.learning === 'on';

		// Re-load brain in case it was modified by another request
		const currentBrainData = await getBrain(null, groupId, config.personality);
		if (currentBrainData) {
			hal.load(currentBrainData);
		}

		// Learn from the current message
		hal.reply(text);
		const newBrainData = hal.save();
		if (newBrainData) {
			await saveBrain(null, groupId, config.personality, newBrainData);
		}
	} catch (err) {
		console.error('Learning failed:', err);
	}

	// Return OK - reply already sent and learning/save completed
	return c.text('OK');
});

async function handleAdminCommand(c: any, body: GroupMeMessage, config: GroupConfig, botId: string) {
	const parts = body.text!.split(' ');
	const cmd = parts[0].slice(1).toLowerCase(); // remove '!'
	const arg = parts[1]?.toLowerCase();

	let replyText = 'Unknown admin command.';

	if (cmd === 'personality' && arg) {
		config.personality = arg;
		replyText = `Personality changed to ${arg}`;
		await saveGroupConfig(null, body.group_id, config);
	} else if (cmd === 'learning' && (arg === 'on' || arg === 'off')) {
		config.learning = arg;
		replyText = `Learning is now ${arg}`;
		await saveGroupConfig(null, body.group_id, config);
	} else if (cmd === 'prefix' && arg) {
		config.prefix = arg;
		replyText = `Prefix set to ${arg}`;
		await saveGroupConfig(null, body.group_id, config);
	}

	// Send the confirmation message
	await fetch('https://api.groupme.com/v3/bots/post', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			bot_id: botId,
			text: replyText,
		}),
	});

	return c.text('Admin command handled');
}

// Export for Vercel
export const POST = handle(app);
export const GET = handle(app);
