# Marketing video kit

Starter pieces for a Remotion promo video, taken from the Fee Recovery video.
Copy what you need into a video's `project/src/` and adapt it; never edit the
kit itself (the agent replaces it on update).

| File | What it gives you |
|---|---|
| `src/theme.ts` | Fonts (Plus Jakarta Sans headlines, Inter UI), the warm colour palette, shadows, `FPS` |
| `src/components/core.tsx` | `Background` (warm gradient), `SceneFrame` (fade in/out), `Headline` (word-by-word reveal, `*word*` gets the highlight swipe), `Camera` (zoom/pan keyframes + blur), `Cursor` (animated pointer with clicks), `Check`, `Card`, `StatCard` |
| `src/components/motion.ts` | `ease`, `lerp`, `pop` (spring), `typed` (typing), `count` (number roll), `money` |
| `scripts/voice.mjs` | ElevenLabs voiceover: one clip per scene from `voice/lines.json` |

A finished example is in `../example/fee-recovery/` (script in `SCRIPT.md`,
music notes in `MUSIC-NOTES.md`). Its product mockups (`admin.tsx`,
`fields.tsx`, `donor.tsx`) are WP Simple Pay's; build your own for other UI.
