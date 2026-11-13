// Generates one ElevenLabs voiceover clip per scene and records durations.
// Usage: npm run voice            (skips clips that already exist)
//        npm run voice -- --force (regenerates everything)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lines = JSON.parse(readFileSync(path.join(root, 'src/voice-lines.json'), 'utf8'));

const raw = readFileSync(path.join(root, '..', 'elevenlabs.txt'), 'utf8');
const key = (raw.match(/sk_[A-Za-z0-9]+/) || [raw.trim().split(/[=:]\s*/).pop()])[0].trim();

const VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Sarah - Mature, Reassuring, Confident
const MODEL = 'eleven_multilingual_v2';
const force = process.argv.includes('--force');

const durations = {};
for (const [id, text] of Object.entries(lines)) {
	const out = path.join(root, 'public/vo', `${id}.mp3`);
	if (force || !existsSync(out)) {
		const res = await fetch(
			`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
			{
				method: 'POST',
				headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					text,
					model_id: MODEL,
					voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.25, use_speaker_boost: true, speed: 0.95 },
				}),
			}
		);
		if (!res.ok) {
			console.error(`${id}: HTTP ${res.status} ${await res.text()}`);
			process.exit(1);
		}
		writeFileSync(out, Buffer.from(await res.arrayBuffer()));
		console.log(`generated ${id}`);
	}
	const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim();
	durations[id] = Number(d);
}
writeFileSync(path.join(root, 'src/vo-durations.json'), JSON.stringify(durations, null, 2));
console.log(durations);
