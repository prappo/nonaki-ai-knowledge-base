/**
 * What each Marketing stage's Claude Code session is told to do. The text is
 * written into the video folder (.instructions/<stage>.md) and the session's
 * prompt points at it, so the transcript stays readable and the instructions
 * can be read back later.
 *
 * Distilled from the session that made the Fee Recovery video by hand: the
 * story structure, the style, and the mistakes it had to fix along the way.
 */

import path from 'node:path';
import { OUTPUTS, STAGE_INFO, type MarketingStageId, type VideoBrief } from './marketing.ts';

export interface PromptContext {
	product: string;
	repo: string;
	home: string;
	folder: string;
	brief: VideoBrief;
	/** What you asked for on this run (a revision), if anything. */
	notes: string;
	/** The stage already ran: this run revises its result. */
	again: boolean;
}

const composition = ( slug: string ) =>
	slug
		.split( '-' )
		.map( ( part ) => part.charAt( 0 ).toUpperCase() + part.slice( 1 ) )
		.join( '' )
		.replace( /^(\d)/, 'V$1' );

function header( stage: MarketingStageId, ctx: PromptContext ): string {
	const { brief } = ctx;
	return `# ${ STAGE_INFO[ stage ].title }: "${ brief.title }"

You are making a short marketing video for **${ ctx.product }** (the product in this repo, \`${ ctx.repo }\`). This session does one step: **${ STAGE_INFO[ stage ].title.toLowerCase() }**. The Marketing page runs the other steps as separate sessions, so do only this one.

## The brief

- **Feature / change:** ${ brief.feature.replace( /\n+/g, ' ' ) }
- **Story notes:** ${ brief.story ? brief.story.replace( /\n+/g, ' ' ) : '(none: work out the persona and numbers yourself)' }
- **Audience:** ${ brief.audience || '(not given: the product’s typical customer)' }
- **Length:** about ${ brief.length } seconds
- **Voiceover:** ${ brief.voice ? 'yes (ElevenLabs)' : 'no: music and on-screen text only' }
- **Music mood:** ${ brief.music || '(not given: pick one that fits the story)' }

## Where things are

- Video folder: \`${ ctx.folder }\`. Write only inside it. Never change, commit or push anything in the repo.
- Script: \`${ path.join( ctx.folder, OUTPUTS.script ) }\`
- Shared Remotion install (one for every video): \`${ ctx.home }\` (\`node_modules\`, \`package.json\`)
- Starter kit: \`${ path.join( ctx.home, 'kit' ) }\` (see its README.md)
- Finished example (Fee Recovery, WP Simple Pay): \`${ path.join( ctx.home, 'example', 'fee-recovery' ) }\` (its SCRIPT.md, MUSIC-NOTES.md and src/)
${
	ctx.again
		? `\nThis step already ran once for this video. **Revise what is there** rather than starting over, unless the notes below ask for a fresh take.\n`
		: ''
}${ ctx.notes ? `\n## What the user asked for on this run\n\n${ ctx.notes }\n\nThis comes first: when it conflicts with the rules below, follow it and say so in your summary.\n` : '' }`;
}

const SCRIPT = ( ctx: PromptContext ) => `${ header( 'script', ctx ) }
## 1. Learn the feature from the repo

Read before you write. The video must show the product's **real** wording and behaviour:

- the user docs (\`docs-user/\`, \`docs/\` or similar) and any screenshots of this feature;
- the UI strings in the code (\`__( '…' )\`, labels, defaults, placeholders), so the mockups use real labels;
- the release notes or changelog entry, if the feature is new;
- the limits: licences or plans it needs, what it doesn't work with. A promo must not promise what the product can't do.

## 2. Tell it as a story, not a feature list

Don't state the problem as a generic sentence ("Payments are hard"). Show it through one person and one task, like a short ad:

- **Persona:** a name and a business (fictional), e.g. "Priya runs Riverbend Animal Rescue".
- **The pain:** what the old way costs them (money, hours, lost customers), said as a contrast line: "<result in one step>. Not <the old painful way>."
- **Meet the feature:** where it lives in the product.
- **The one action:** the single thing they do with it, shown on screen.
- **The reveal:** the moment it fixes or shows something they couldn't do alone. This is the emotional peak.
- **The payoff:** a concrete outcome with a number.
- **A follow-up beat:** one more small thing that updates live.
- **End card:** the product's logo, a tagline and a call to action.

Rules:

- One consistent set of fake numbers for the whole video (same totals, dates, names). Write them down at the top and **check the maths** (fees, percentages, totals) in a short "Math check" section.
- Headlines are short (2 to 6 words) and read as a sentence across scenes. Mark the key phrase of each in **bold**: it gets the highlight swipe.
- Each scene says what the viewer should feel (recognition → curiosity → relief → want).
- Scenes are about 4 to 8 seconds; together they make about ${ ctx.brief.length } seconds.
${ ctx.brief.voice ? '- Write one voiceover line per scene: natural speech, numbers spoken as people say them ("a dollar seventy-five"), and short enough to fit the scene (about 2.5 words per second).\n' : '' }
## 3. Write \`${ OUTPUTS.script }\`

Save it in the video folder, in this shape:

\`\`\`markdown
# <Title>: promo script (about ${ ctx.brief.length }s)

**Persona:** …
**Numbers used throughout (keep these identical in every scene):** …

| # | Time | Headline (**bold** = highlight) | On screen | Viewer feels |
|---|---|---|---|---|
| 1 | 0–5s | "…" | … | … |
…
${ ctx.brief.voice ? '\n## Voiceover\n\ns1: First line.\ns2: Second line.\n…\n' : '' }
## Math check
…

## Accuracy notes
- what you checked in the repo (with the file it came from)
- what is invented for the story (persona, numbers)
- limits the video must respect (licences, unsupported cases)
\`\`\`
${ ctx.brief.voice ? '\nThe `## Voiceover` section must have exactly one `sN:` line per scene, in order: the voiceover step reads it.\n' : '' }
Write no code and don't start any other step.

## 4. Finish

Reply with a short summary: the persona, the hook and the payoff, the length, and anything in the accuracy notes the user should decide. The user reviews and edits the script on the Marketing page and approves it there; nothing else runs until they do.
`;

const MUSIC = ( ctx: PromptContext ) => `${ header( 'music', ctx ) }
## 1. Know the mood

Read \`${ OUTPUTS.script }\`: its tone, its length, and which scene is the emotional peak (the reveal or payoff). The track should stay calm under the problem and lift at that scene.

## 2. Find a track with Claude in Chrome

Use Claude in Chrome (load the browser tools in one ToolSearch call, call \`tabs_context_mcp\`, open a new tab). Pixabay blocks command-line requests, so go through the browser.

1. Search \`https://pixabay.com/music/search/<mood words>/\` (add \`?duration=0-180\`). Try two or three searches.
2. Shortlist tracks that fit. Open each one's page and check:
   - the licence (Pixabay Content License: free for commercial use);
   - whether it says **"Content ID Registered"**. Those tracks can get a YouTube copyright claim. Prefer one without it; if every good fit is registered, pick the best one and say so.
   - it is at least as long as the video.
3. Download it with the page's **Free download** button. Never sign in, never pay, never accept anything beyond the free download. If a download needs an account, stop and ask the user.
4. Chrome saves to \`~/Downloads\`. It may leave the finished file under a hidden temporary name (\`~/Downloads/.com.google.Chrome.*\`) while it waits for confirmation: if so, copy that file. Check it with \`ffprobe\` (duration, bitrate).
5. Save it as \`${ OUTPUTS.music }\` in the video folder. Close the tab you opened.

## 3. Map its shape

Measure where it gets louder, in 3-second steps:

\`\`\`bash
ffmpeg -v info -i ${ OUTPUTS.music } -af "asetnsamples=n=132300,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null - 2>&1 | grep RMS_level | sed 's/.*RMS_level=//' | awk '{printf "%3ds %6.1f dB\\n", (NR-1)*3, $1}'
\`\`\`

## 4. Write \`${ OUTPUTS.musicNotes }\`

- title, artist, page URL, licence, and the Content ID status (with how to clear a YouTube claim: dispute it with the licence certificate from the track page, logged in to Pixabay);
- duration and the loudness map in short;
- the cut to use: start offset, where it swells, which scene that lines up with, the fade out;
- why this track fits the story.

Reply with the track, why you picked it, and its Content ID status.
`;

const VOICE = ( ctx: PromptContext ) => `${ header( 'voice', ctx ) }
## 1. The lines

Read the \`## Voiceover\` section of \`${ OUTPUTS.script }\` and write \`${ OUTPUTS.voiceDir }/lines.json\`: one entry per scene, in order, keyed \`s1\`, \`s2\`, … with the exact line. Write numbers as they should be spoken. If the section is missing, write the lines from the scene table and say so.

## 2. The voice

The default is ElevenLabs' "Sarah" (warm, reassuring), \`eleven_multilingual_v2\`, speed 0.95. To choose another voice that suits the story better, list them:

\`\`\`bash
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v1/voices | python3 -c 'import json,sys; [print(v["voice_id"], v["name"], v.get("labels")) for v in json.load(sys.stdin)["voices"]]'
\`\`\`

and save your choice in \`${ OUTPUTS.voiceDir }/settings.json\` as \`{ "voiceId": "…", "model": "eleven_multilingual_v2", "speed": 0.95 }\`.

The key is in \`$ELEVENLABS_API_KEY\`. **Never print it, echo it, or write it into any file.**

## 3. Generate

\`\`\`bash
node ${ path.join( ctx.home, 'kit', 'scripts', 'voice.mjs' ) } "${ ctx.folder }"${ ctx.again ? ' --force' : '' }
\`\`\`

It writes \`${ OUTPUTS.voiceDir }/s1.mp3\`, … and \`${ OUTPUTS.voiceDurations }\`. Add \`--force\` when you changed lines that already have clips (or delete just those clips).

## 4. Check

Compare each clip's length with its scene's planned time. Report the total, and every scene whose line runs longer than the scene (the build step stretches scenes to fit the voice, so a long line makes a longer video).
`;

const BUILD = ( ctx: PromptContext ) => {
	const id = composition( ctx.brief.slug );
	const bin = path.join( ctx.home, 'node_modules', '.bin' );
	return `${ header( 'build', ctx ) }
## 1. The shared install

If \`${ path.join( ctx.home, 'node_modules', 'remotion' ) }\` doesn't exist, run \`npm install\` in \`${ ctx.home }\` once. Never install packages inside the video's project: it resolves them from the shared install.

## 2. Set up \`project/\`

In the video folder, create \`project/\` (or update it, if it exists):

- \`package.json\` with \`"type": "module"\`, no dependencies, and scripts:
  - \`"preview": "${ bin }/remotion studio src/index.ts"\`
  - \`"render": "${ bin }/remotion render src/index.ts ${ id } ../out/${ ctx.brief.slug }.mp4"\`
- \`tsconfig.json\` from the kit.
- \`src/\`: copy the kit's \`theme.ts\` and \`components/\` and build on them. Look at the example's \`src/\` to see how a whole video fits together.
- \`public/\`: copy \`../${ OUTPUTS.music }\` to \`public/music.mp3\`${ ctx.brief.voice ? `, the clips in \`../${ OUTPUTS.voiceDir }/\` to \`public/vo/\`` : '' }, and the product's logo from the repo (search for its SVG).
- \`README.md\`: which file controls what (headlines, timings, colours, music volume${ ctx.brief.voice ? ', voiceover lines' : '' }), and the commands.

The composition id is \`${ id }\`: 1920×1080, 30 fps.

## 3. Build the scenes

Follow \`${ OUTPUTS.script }\` **exactly**: the headlines, the numbers, the order. It was approved; if something in it can't be shown, say so instead of changing it quietly.

Style: motion graphics, not a screen recording.

- Warm soft gradient background, big bold headlines at the top of each scene, revealed word by word, with a highlight swipe behind the **bold** phrase.
- The product's UI rebuilt as clean HTML/CSS mockups with the script's fake data, matching the real product: use its screenshots and CSS in the repo for colours, layout and wording.
- Camera moves: slow zoom and pan into what matters, blur on the surroundings, smooth spring easing, no hard cuts.
- Stat cards that pop out of the UI for the numbers; an animated cursor for clicks, typing and drag-and-drop.
- Each scene is its own component; every timing lives in one \`src/config.ts\`.
${
	ctx.brief.voice
		? `- Time each scene to its voiceover: read \`../${ OUTPUTS.voiceDurations }\`, start the line about 8 frames into the scene, and give it at least 0.8s after the line ends.\n`
		: ''
}- Music: \`public/music.mp3\` from the offset in \`../${ OUTPUTS.musicNotes }\`, fading in over 1s and out over the last 2s${ ctx.brief.voice ? ', and ducked (quieter) while the voice speaks' : '' }. Line its swell up with the emotional peak.
- Keep headlines readable while the camera zooms (render them outside the camera layer), and keep every scene's composition balanced: no empty half of the frame.

## 4. Check it the way a viewer would

1. Type-check: \`${ bin }/tsc -p project\`.
2. Render a half-size draft from \`project/\`: \`${ bin }/remotion render src/index.ts ${ id } ../out/draft.mp4 --scale=0.5\`.
3. Make a contact sheet: one frame from the middle of every scene, tiled, saved as \`${ OUTPUTS.review }\` (ffmpeg \`select\` + \`tile\`, or \`remotion still\` per scene and \`tile\`). **Read the image** and look for overlapping or cut-off text, unreadable small text, empty areas, mockups that don't look like the product, wrong numbers.
4. Fix what you find and do steps 2 and 3 again. Do at least one round of fixes.

\`${ OUTPUTS.review }\` must show the final build: the Marketing page shows it, and the render step needs it. Reply with what is in the video, any changes from the script and why, and what still looks weak.
`;
};

const RENDER = ( ctx: PromptContext ) => {
	const id = composition( ctx.brief.slug );
	const bin = path.join( ctx.home, 'node_modules', '.bin' );
	const out = OUTPUTS.video( ctx.brief.slug );
	return `${ header( 'render', ctx ) }
## 1. Render

From \`project/\`:

\`\`\`bash
${ bin }/remotion render src/index.ts ${ id } ../${ out } --crf=18
\`\`\`

## 2. Check the result

- \`ffprobe\`: 1920×1080, 30 fps, an audio stream, the expected length.
- Loudness: \`ffmpeg -i ${ out } -af ebur128=framelog=quiet -f null - 2>&1 | tail -12\`. Aim for about -16 LUFS integrated (social media). If it's off by more than 2 LU, adjust the music${ ctx.brief.voice ? '/voice' : '' } volume in the project and render again.
- Pull one frame from the emotional-peak scene and one from the end card, read them, and make sure they look right at full size.
- Delete \`out/draft.mp4\` if it's there.

## 3. Report

Reply with the file, its length and size, the loudness, and what a person still has to check before publishing: watch it with sound (you can't hear it), the made-up numbers must read as an example, and the music's Content ID status from \`${ OUTPUTS.musicNotes }\`.
`;
};

const BUILDERS: Record<MarketingStageId, ( ctx: PromptContext ) => string> = { script: SCRIPT, music: MUSIC, voice: VOICE, build: BUILD, render: RENDER };

export function stageInstructions( stage: MarketingStageId, ctx: PromptContext ): string {
	return BUILDERS[ stage ]( ctx );
}

/** The session's prompt: short, pointing at the instructions file. */
export function stagePrompt( stage: MarketingStageId, title: string, file: string, notes: string ): string {
	const ask = notes ? `\n\nThe user's notes for this run (also in the instructions): ${ notes.replace( /\s+/g, ' ' ).slice( 0, 300 ) }` : '';
	return `Marketing video "${ title }": ${ STAGE_INFO[ stage ].title.toLowerCase() }. Read ${ file } and follow it exactly.${ ask }`;
}
