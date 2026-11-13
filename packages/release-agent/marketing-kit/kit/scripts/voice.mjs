// Generates one ElevenLabs voiceover clip per scene and records their lengths.
//
//   node <kit>/scripts/voice.mjs <video folder>            (skips clips that already exist)
//   node <kit>/scripts/voice.mjs <video folder> --force    (regenerates every clip)
//
// Reads  <video>/voice/lines.json      { "s1": "First line.", "s2": "…" }
//        <video>/voice/settings.json   optional { "voiceId", "model", "speed" }
// Writes <video>/voice/<id>.mp3 and <video>/voice/durations.json (seconds).
// The API key comes from ELEVENLABS_API_KEY, which the Marketing page gives
// voiceover sessions. It is never printed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? '.');
const force = process.argv.includes('--force');
const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
	console.error('ELEVENLABS_API_KEY is not set. Add the key on the Marketing page (Setup).');
	process.exit(1);
}

const read = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);
const lines = read(path.join(dir, 'voice/lines.json'), null);
if (!lines) {
	console.error(`No ${path.join(dir, 'voice/lines.json')}`);
	process.exit(1);
}
const settings = {
	voiceId: 'EXAVITQu4vr4xnSDxMaL', // Sarah: mature, reassuring, confident
	model: 'eleven_multilingual_v2',
	speed: 0.95,
	...read(path.join(dir, 'voice/settings.json'), {}),
};

const durations = {};
for (const [id, text] of Object.entries(lines)) {
	const out = path.join(dir, 'voice', `${id}.mp3`);
	if (force || !existsSync(out)) {
		const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${settings.voiceId}?output_format=mp3_44100_128`, {
			method: 'POST',
			headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				text,
				model_id: settings.model,
				voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.25, use_speaker_boost: true, speed: settings.speed },
			}),
		});
		if (!res.ok) {
			console.error(`${id}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
			process.exit(1);
		}
		writeFileSync(out, Buffer.from(await res.arrayBuffer()));
		console.log(`generated ${id}`);
	}
	const seconds = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim();
	durations[id] = Number(seconds);
}
writeFileSync(path.join(dir, 'voice/durations.json'), JSON.stringify(durations, null, 2) + '\n');
console.log(JSON.stringify(durations));
