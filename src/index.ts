import { Buffer } from "node:buffer";
/// <reference types="@cloudflare/workers-types" />
import { Hono } from 'hono';
import { MegaHAL } from './megahal/megahal';

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

	// Phase 3: Anti-Loop
	if (body.sender_type === 'bot' || body.sender_type === 'system') {
		return c.text('Ignored bot/system message');
	}

	const groupId = body.group_id;
	const botId = c.env[`BOT_ID_${groupId}`];

	// Ignore if no bot_id is configured for this group
	if (!botId) {
		return c.text('Group not configured');
	}

	// Phase 3: Load config
	const config = await getGroupConfig(c.env.MEGAHAL_KV, groupId);

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

	// MegaHAL Processing
	const hal = new MegaHAL(config.personality);
	hal.learning = config.learning === 'on';

	// Try to load brain from KV
	const brainData = await getBrain(c.env.MEGAHAL_KV, groupId, config.personality);
	if (brainData) {
		hal.load(brainData);
	}

	const reply = hal.reply(text);

	if (hal.learning) {
		const newBrainData = hal.save();
		if (newBrainData) {
			await saveBrain(c.env.MEGAHAL_KV, groupId, config.personality, newBrainData);
		}
	}

	if (reply) {
		// Post to GroupMe API
		await fetch('https://api.groupme.com/v3/bots/post', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				bot_id: botId,
				text: reply,
			}),
		});
	}

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
