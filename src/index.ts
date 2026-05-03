import { Hono } from 'hono';
import { ChatEngineRegistry } from './engines/index.js';
// Import MegaHAL engine to register it (lazy-loaded via registry)
import './engines/megahal/index.js';
import type { ChatEngine } from './engines/types.js';

// Vercel Node.js runtime - use process.env instead of Bindings
export interface GroupConfig {
	personality: string;
	learning: 'on' | 'off';
	prefix: string | 'none';
	engine: string; // default: 'megahal'
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
			engine: 'megahal',
		}
	);
};

export const saveGroupConfig = async (_kv: any, groupId: string, config: GroupConfig): Promise<void> => {
	configStore.set(`config:${groupId}`, config);
};

export const getBrain = async (_kv: any, groupId: string, engine: string, personality: string): Promise<Uint8Array | null> => {
	return brainStore.get(`brain:${groupId}:${engine}:${personality}`) || null;
};

export const saveBrain = async (_kv: any, groupId: string, engine: string, personality: string, brain: Uint8Array): Promise<void> => {
	brainStore.set(`brain:${groupId}:${engine}:${personality}`, brain);
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

	// Get the chat engine via registry (lazy-loaded)
	const engine = await ChatEngineRegistry.getEngine(config.engine);
	if (!engine) {
		console.error(`Engine '${config.engine}' not found`);
		return c.text(`Engine '${config.engine}' not available`);
	}

	// Load brain from storage if it exists
	const brainData = await getBrain(null, groupId, config.engine, config.personality);
	if (brainData) {
		engine.load(brainData); // Fast binary load (Takes < 1ms)
	} else {
		// Initialize engine with personality if no brain exists
		if (engine.become) {
			await engine.become(config.personality);
		}
	}

	// Disable learning during main request loop to avoid Markov CPU drain
	// (MegaHALEngine.learning is a setter that propagates to underlying MegaHAL)
	if ('learning' in engine) {
		(engine as any).learning = false;
	}

	const reply = engine.reply(text);

	// POST REPLY FIRST (await required for serverless)
	// Must await before returning to prevent container freeze
	if (reply) {
		try {
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
			console.log('Successfully posted reply to GroupMe');
		} catch (err) {
			console.error('Failed to post reply:', err);
		}
	}

	// Learning and save - run after reply is actually sent
	// Vercel Node.js has 300s timeout, so we can await this directly
	try {
		// Enable learning for the save operation
		if ('learning' in engine) {
			(engine as any).learning = config.learning === 'on';
		}

		// Re-load brain in case it was modified by another request
		const currentBrainData = await getBrain(null, groupId, config.engine, config.personality);
		if (currentBrainData) {
			engine.load(currentBrainData);
		}

		// Learn from the current message
		engine.learn(text);
		const newBrainData = engine.save();
		if (newBrainData) {
			await saveBrain(null, groupId, config.engine, config.personality, newBrainData);
		}
	} catch (err) {
		console.error('Learning failed:', err);
	}

	// Return OK - reply already sent and learning/save completed
	return c.text('OK');
});

// Interactive config commands
// Note: personalities are lazy-loaded via MegaHAL, but we list them here for the menu
const PERSONALITIES = [
	'aliens', 'bill', 'caitsith', 'default', 'ferris',
	'manson', 'pepys', 'pulp', 'scream', 'sherlock',
	'startrek', 'starwars'
];

// Available engines (can be extended)
const ENGINES = ['megahal']; // Add more engines here as they become available

const CONFIG_COMMANDS = [
	{ num: 1, name: 'personality', desc: 'Change the bot personality', usage: '!personality <name>' },
	{ num: 2, name: 'learning', desc: 'Toggle learning on/off', usage: '!learning <on|off>' },
	{ num: 3, name: 'prefix', desc: 'Set command prefix', usage: '!prefix <character|none>' },
	{ num: 4, name: 'engine', desc: 'Change the chat engine', usage: '!engine <name>' },
];

async function handleAdminCommand(c: any, body: GroupMeMessage, config: GroupConfig, botId: string) {
	const text = body.text || '';
	const parts = text.split(' ');
	const cmd = parts[0].slice(1).toLowerCase(); // remove '!'
	const arg = parts[1]?.toLowerCase();

	// !config - show interactive list of commands
	if (cmd === 'config') {
		let replyText = '⚙️ *Config Commands*\n\n';
		replyText += 'Reply with a number for more info:\n\n';
		for (const com of CONFIG_COMMANDS) {
			replyText += `${com.num}. ${com.name} - ${com.desc}\n`;
		}
		replyText += '\nOr use directly: !<command> <value>';

		await postMessage(botId, replyText);
		return c.text('OK');
	}

	// !{number} - show help for that command
	const num = parseInt(cmd, 10);
	if (!isNaN(num) && num >= 1 && num <= CONFIG_COMMANDS.length) {
		const com = CONFIG_COMMANDS[num - 1];
		let replyText = `*${com.name.toUpperCase()}*\n`;
		replyText += `${com.desc}\n\n`;
		replyText += `Current: ${config[com.name as keyof GroupConfig]}\n`;
		replyText += `Usage: ${com.usage}`;

		await postMessage(botId, replyText);
		return c.text('OK');
	}

	// --- Interactive submenu handlers ---
	if (cmd === 'personality') {
		if (!arg) {
			// Show personality selection menu
			let replyText = '🎭 *Personality Selection*\n\n';
			replyText += `Current: *${config.personality}*\n\n`;
			replyText += 'Reply with a number to select:\n\n';
			PERSONALITIES.forEach((p, i) => {
				const marker = p === config.personality ? ' ✅' : '';
				replyText += `${i + 1}. ${p}${marker}\n`;
			});
			await postMessage(botId, replyText);
			return c.text('OK');
		}
		if (!PERSONALITIES.includes(arg)) {
			// Invalid personality, show menu
			let replyText = `❌ Unknown personality: *${arg}*\n\n`;
			replyText += 'Available personalities:\n\n';
			PERSONALITIES.forEach((p, i) => {
				replyText += `${i + 1}. ${p}\n`;
			});
			await postMessage(botId, replyText);
			return c.text('OK');
		}
		config.personality = arg;
		await saveGroupConfig(null, body.group_id, config);
		await postMessage(botId, `✅ Personality changed to *${arg}*`);
		return c.text('OK');
	}

	if (cmd === 'learning') {
		if (!arg) {
			let replyText = '📚 *Learning Options*\n\n';
			replyText += `Current: *${config.learning}*\n\n`;
			replyText += 'Reply with a number to select:\n\n';
			replyText += `1. on - Bot learns from messages\n`;
			replyText += `2. off - Bot won't learn\n`;
			await postMessage(botId, replyText);
			return c.text('OK');
		}
		if (arg !== 'on' && arg !== 'off') {
			let replyText = `❌ Invalid option: *${arg}*\n\n`;
			replyText += 'Options:\n';
			replyText += `1. on - Enable learning\n`;
			replyText += `2. off - Disable learning\n`;
			await postMessage(botId, replyText);
			return c.text('OK');
		}
		config.learning = arg;
		await saveGroupConfig(null, body.group_id, config);
		await postMessage(botId, `✅ Learning is now *${arg}*`);
		return c.text('OK');
	}

	if (cmd === 'prefix') {
		if (!arg) {
			let replyText = '🔤 *Prefix Options*\n\n';
			replyText += `Current: *${config.prefix === 'none' ? 'none (no prefix)' : config.prefix}*\n\n`;
			replyText += 'Reply with a number to select:\n\n';
			replyText += '1. $ - Use $ as prefix\n';
			replyText += '2. ! - Use ! as prefix\n';
			replyText += '3. none - No prefix required\n';
			replyText += '4. custom - Set a custom prefix\n';
			await postMessage(botId, replyText);
			return c.text('OK');
		}
		if (arg === 'custom') {
			await postMessage(botId, '💬 Send your custom prefix (single character or "none")');
			return c.text('OK');
		}
		config.prefix = arg;
		await saveGroupConfig(null, body.group_id, config);
		await postMessage(botId, `✅ Prefix set to *${arg}*`);
		return c.text('OK');
	}

	if (cmd === 'engine') {
		if (!arg) {
			// Show engine selection menu
			let replyText = '⚙️ *Chat Engine Selection*\n\n';
			replyText += `Current: *${config.engine}*\n\n`;
			replyText += 'Reply with a number to select:\n\n';
			ENGINES.forEach((e, i) => {
				const marker = e === config.engine ? ' ✅' : '';
				replyText += `${i + 1}. ${e}${marker}\n`;
			});
			await postMessage(botId, replyText);
			return c.text('OK');
		}
		if (!ENGINES.includes(arg)) {
			// Invalid engine, show menu
			let replyText = `❌ Unknown engine: *${arg}*\n\n`;
			replyText += 'Available engines:\n\n';
			ENGINES.forEach((e, i) => {
				replyText += `${i + 1}. ${e}\n`;
			});
			await postMessage(botId, replyText);
			return c.text('OK');
		}
		config.engine = arg;
		await saveGroupConfig(null, body.group_id, config);
		await postMessage(botId, `✅ Engine changed to *${arg}*`);
		return c.text('OK');
	}

	// Unknown command
	await postMessage(botId, '❓ Unknown command. Use !config for available commands.');
	return c.text('OK');
}

async function postMessage(botId: string, text: string) {
	await fetch('https://api.groupme.com/v3/bots/post', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			bot_id: botId,
			text: text,
		}),
	});
}

// Export for Vercel Node.js runtime
export default app;
