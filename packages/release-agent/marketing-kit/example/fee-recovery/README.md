# Fee Recovery promo video (Remotion)

63s, 1920x1080, 30fps. Script: `../fee-recovery-script.md`. Music: `../music-notes.md`.

## Commands

```bash
npm run preview          # Remotion Studio: scrub, tweak, live reload
npm run render           # → out/fee-recovery-promo.mp4
npm run voice            # generate missing voiceover clips (ElevenLabs)
npm run voice -- --force # regenerate every clip
```

## Where to change things

| What | File |
|---|---|
| Voiceover text | `src/voice-lines.json`, then run `npm run voice -- --force` |
| Voice / model / speed | `scripts/voice.mjs` (`VOICE_ID`, `MODEL`, `speed`) |
| Scene lengths | `src/config.ts` (`SCENES`, in seconds) |
| Scene visuals, headlines, cursor paths | `src/scenes/index.tsx` |
| Colors, fonts | `src/theme.ts` |
| Music volume and ducking | `src/Video.tsx` (`MUSIC_FULL`, `MUSIC_DUCKED`) |

Headlines: wrap words in `*asterisks*` to give them the blue highlight swipe.

The ElevenLabs key is read from `../elevenlabs.txt`.

> Reference copy kept by the Marketing page. It was made before the kit
> existed: its `scripts/voice.mjs` reads a key file, while new videos use the
> kit's `scripts/voice.mjs` and the `ELEVENLABS_API_KEY` environment variable.
