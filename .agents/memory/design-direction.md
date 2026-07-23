---
name: AI Rank design direction
description: The app's visual reference (datainc.ai) and the resulting theme decisions
---
The AI Rank web app is themed after datainc.ai, which is a **light** design — cool off-white canvas, emerald green primary/accent, near-black ink text, coral-red destructive, Inter for sans, IBM Plex Mono for mono/uppercase labels, small radii, hairline borders, minimal shadows.

**Why:** A redesign task described datainc.ai as dark navy with glows, but the actual site is light; we mirrored the real site. Light is the default; the `.dark` palette is a matching deep-charcoal/emerald family.

**How to apply:** Keep new UI token-driven (theme vars in the app's index.css); don't reintroduce the old cobalt/lime palette or assume a dark default.
