import { Buffer } from "node:buffer";
/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono';
import { MegaHAL } from './megahal/megahal';
// Note: personalities are now lazy-loaded, no need to import all of them

export type Bindings = {
	MEGAHAL_KV: KVNamespace;
	OWNER_USER_ID: string;
} & Record<string, string>;

export interface GroupConfig {
	personality: string;
	learning: 'on' | 'off';
	prefix: string | 'none';
}

export const getGroupConfig = async (kv: KVNamespace, groupId: string): Promise<GroupConfig> => {
	const config = (await kv.get(`config:${groupId}`, 'json')) as GroupConfig | null;
	return (
		config || {
			personality: 'default',
			learning: 'on',
			prefix: '$',
		}
	);
};

export const saveGroupConfig = async (kv: KVNamespace, groupId: string, config: GroupConfig): Promise<void> => {
	await kv.put(`config:${groupId}`, JSON.stringify(config));
};

export const getBrain = async (kv: KVNamespace, groupId: string, personality: string): Promise<Uint8Array | null> => {
	const brainBuffer = await kv.get(`brain:${groupId}:${personality}`, 'arrayBuffer');
	return brainBuffer ? new Uint8Array(brainBuffer) : null;
};

export const saveBrain = async (kv: KVNamespace, groupId: string, personality: string, brain: Uint8Array): Promise<void> => {
	await kv.put(`brain:${groupId}:${personality}`, brain.buffer as ArrayBuffer);
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => c.text('MegaHAL Bot is running!'));

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
	const botId = c.env[`BOT_ID_${groupId}`];
	console.log(`Group ID: ${groupId}, Bot ID found: ${!!botId}`); // LOG 2

	// Ignore if no bot_id is configured for this group
	if (!botId) {
		return c.text('Group not configured');
	}

	// Phase 3: Load config
	const config = await getGroupConfig(c.env.MEGAHAL_KV, groupId);
	console.log(`Prefix expected: ${config.prefix}`); // LOG 3

	// Phase 4 command interception hook placeholder
	if (body.text?.startsWith('!') && body.user_id === c.env.OWNER_USER_ID) {
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

	// Try to load brain from KV first!
	const brainData = await getBrain(c.env.MEGAHAL_KV, groupId, config.personality);
	if (brainData) {
		hal.load(brainData); // Fast binary load (Takes < 1ms)
	} else {
		// ONLY train from scratch if the brain doesn't exist in KV yet
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

	// Background learning and save - runs after response is sent
	// This prevents the 10ms CPU timeout by moving heavy work outside main request
	c.executionCtx.waitUntil(
		(async () => {
			try {
				// Enable learning for the background save operation
				hal.learning = config.learning === 'on';

				// Re-load brain in case it was modified by another request
				const currentBrainData = await getBrain(c.env.MEGAHAL_KV, groupId, config.personality);
				if (currentBrainData) {
					hal.load(currentBrainData);
				}

				// Learn from the current message
				hal.reply(text);
				const newBrainData = hal.save();
				if (newBrainData) {
					await saveBrain(c.env.MEGAHAL_KV, groupId, config.personality, newBrainData);
				}
			} catch (err) {
				console.error('Background learning failed:', err);
			}
		})()
	);

	// Return OK immediately - reply already sent and background task started
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
		await saveGroupConfig(c.env.MEGAHAL_KV, body.group_id, config);
	} else if (cmd === 'learning' && (arg === 'on' || arg === 'off')) {
		config.learning = arg;
		replyText = `Learning is now ${arg}`;
		await saveGroupConfig(c.env.MEGAHAL_KV, body.group_id, config);
	} else if (cmd === 'prefix' && arg) {
		config.prefix = arg;
		replyText = `Prefix set to ${arg}`;
		await saveGroupConfig(c.env.MEGAHAL_KV, body.group_id, config);
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

export default app;
