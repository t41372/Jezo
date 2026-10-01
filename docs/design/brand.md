# Brand

Status: decided on 2026-10-01.

## The name

Jezo comes from 節奏 (jiézòu), Chinese for rhythm: Jezo helps you find the rhythm of your life. The one-line description is "A local-first personal agent that helps turn your goals into plans and follow-through so you can focus on the present."

## The mark

A J in three segments, like a bamboo stem. 節 first meant the joint of a bamboo stem. Bamboo grows one segment at a time, and the newest segment is at the top, so the top segment is violet: it's the present. Goals turn into plans the same way, one segment after another.

- **Geometry.** Drawn in a 100 × 100 box with a 13-unit stroke and flat ends: two straight segments, then a third that runs into the hook (`M71 34 V52 M71 59 V61 A21 21 0 0 1 29 61`, top segment `M71 9 V27`). The gaps between segments are the joints.
- **Colors** are the app's own: the foreground ink (`oklch(0.22 0.02 265)`, `#171B26`) and the violet of agent drafts (`oklch(0.68 0.13 285)`, `#918BE3`). On a dark background the ink becomes `#EEEDF6` and the violet `#9D96EC`.
- **At 16 px** the joints close up, and the mark reads as a J with a violet top. That's acceptable: it still reads as a J at that size.

## Files

- `docs/brand/mark.svg`, `mark-dark.svg`, `mark-mono.svg`: the mark for light backgrounds, dark backgrounds, and one color.
- `docs/brand/icon.svg`: the app icon. A pale lavender tile on Apple's macOS grid (824 × 824 in a 1024 canvas, corner radius 185) with the mark at 55% of the tile's height. The README shows it.
- `build/icon.png`: the icon at 1024 px, made from `icon.svg` with `rsvg-convert -w 1024 -h 1024 docs/brand/icon.svg -o build/icon.png`. electron-builder makes the `.icns` and `.ico` from it. In development, `src/main/app.ts` puts it in the Dock, which would otherwise show Electron's icon.

The icon is a plain `.icns`, not an Icon Composer `.icon`. electron-builder accepts `.icon`, but compiling one needs `actool` from the full Xcode, which nothing else in the build needs. On macOS 27, Finder shows the `.icns` tile as is, with no grey frame around it.

## Rejected directions

Seven directions were drawn and tested at 16 px, in one color, on dark, and as an app icon.

- **A J whose hook catches a falling dot.** The easiest to recognize at small sizes, and the dot bouncing in the hook could be a beat. It was the runner-up. Rejected because the bamboo J says where the name comes from.
- **A lowercase j with a violet dot.** In one color it's any j.
- **A path climbing in switchbacks toward a dot.** It reads as a lightning bolt or a Z.
- **A J whose top is dashed (draft) and bottom solid (done)**, from the calendar's draft and done blocks. The dashes blur at 16 px. This idea still suits motion, like a plan turning solid once it's accepted.
- **A dashed square (the agent's proposal) under a solid one (you).** It looks like any collaboration tool's logo, and the dashed outline disappears at 16 px.
- **Evenly spaced dots tracing a J, the last one large and violet.** At 16 px the dots blur into a grey line, and the row of dots looks like a loading spinner.
