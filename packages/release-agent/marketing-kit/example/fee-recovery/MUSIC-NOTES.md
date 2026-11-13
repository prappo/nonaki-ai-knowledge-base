# Background music: Fee Recovery promo

**File:** `soft-hopeful-piano-paulyudin.mp3` (1:57, 256 kbps MP3)
**Track:** "Soft Hopeful Piano" by PaulYudin (Pavel Bekirov)
**Source:** https://pixabay.com/music/main-title-soft-hopeful-piano-164828/
**License:** Pixabay Content License. Free for commercial use, attribution not required.

## Why this track

It's a warm, gentle solo piano piece, which suits a small nonprofit story better than peppy "corporate" tracks. It starts quiet and soft during the problem beats (scenes 1–2: the fees taken off each donation) and lifts around the payoff, so the emotion builds with the story.

## How to cut it for the 60s video

Measured loudness of the track:

| Track time | Feel | Video scenes |
|---|---|---|
| 0–38s | Quiet, steady (about −22 dB) | 1–6: hook, pain, setup, donor form |
| 39–48s | Swells (up to about −19 dB) | 7–8: "Priya gets $50.00", 72% opt-in. **The emotional peak lands here.** |
| 48–97s | Fuller, sustained | 9–10: ACH cap, end card |
| 99–117s | Natural ending | (unused, or use it for a longer cut) |

- Use **0:00 → 1:00** with a **2-second fade-out** (58–60s).
- Keep the music low under the UI (around −18 dB relative to any voiceover).
- For a natural ending instead of a fade, cut from 0:00 and jump to the outro at 1:39 for the end card.

In Remotion, put the file at `public/music.mp3` and use:
`<Audio src={staticFile('music.mp3')} volume={(f) => interpolate(f, [1740, 1800], [1, 0], {extrapolateLeft: 'clamp'})} />`

## ⚠️ YouTube Content ID

This track is **registered with YouTube Content ID**, so YouTube may flag a copyright claim when you upload the video. The claim doesn't stop the video from being published. To clear it:

1. Log in to Pixabay, open the track page, and click **Download license certificate**.
2. Dispute the claim in YouTube Studio and attach the certificate (or the license text).

This doesn't affect LinkedIn, X, the website or email; Content ID is YouTube only.

Optional credit line: *Music: "Soft Hopeful Piano" by Pavel Bekirov (PaulYudin) from Pixabay*
