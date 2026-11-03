# Corridor

## What it’s for

A visitor walks a small first-person maze, then splits the screen to see the trick: from the top-down map, one ray per screen column, each wall slice drawn taller the nearer the ray hits. They should leave knowing how early 3D games drew a world with one loop and some trigonometry, and why the fish-eye correction is needed. It is meant to be a game first and a lesson second.

## How I know

**What is modelled.** `model.js` is a grid raycaster of the kind used by early-1990s first-person games. The map is a grid of unit tiles. The camera is a position, a unit direction vector and a camera-plane vector at right angles to it, of length tan(fov/2). For each of the 320 screen columns, `castFrame` casts one ray along `dir + plane * cameraX` and walks the grid with DDA (digital differential analysis): it steps to whichever tile boundary, x or y, comes next, until it enters a wall tile. Because the ray direction is not normalised, the ray parameter at the hit is already the distance measured along the view direction (the "perpendicular" distance). The slice height is `focal / distance`, where `focal = (width / 2) / tan(fov / 2)` keeps pixels square at any field of view. The "Fish-eye correction" toggle swaps in the straight-line distance (the parameter times the ray's length), which makes a flat wall bow outward by a factor of cos(angle off centre). While correction is off, a dotted chalk line marks where each slice's top and bottom would be with the straight-ahead distance, so the bulge shows as a gap even when it is only a few pixels. Billboard sprites (keys and the follow-spot drones) are projected with the same camera and drawn column by column only where they are nearer than that column's wall, using the per-column distances as a depth buffer.

The game logic is also in `model.js`: a seeded maze generator (depth-first backtracker on an 8 x 8 cell grid, some extra openings for loops, two small rooms; default seed 1907), square-box collision resolved one axis at a time with sub-stepping, drones that drift tile to tile using a seeded random generator and lean towards the player when they can see them, a zap beam that is a ray test against the drones' discs, and a door in the outer wall that opens once three keys are held. `app.js` only paints: procedural textures (painted brick, panelling, wallpaper, a stage door), floor casting for the stage boards, ceiling battens, distance fog, and the ground plan.

**What is simplified.**
- It is not real 3D: every wall is one tile tall, the eye is always halfway up, and there are no floors above floors, slopes or stairs. This is the main honesty caveat and it is the one named on the page.
- Wolfenstein 3D itself used fixed-point arithmetic, precomputed tables and a different screen layout. This uses floating point and modern canvas. The method (DDA per column, perpendicular distance, column-scaled textures) is the same; the code is my own, written after reading Lode Vandevenne's tutorial.
- With fish-eye correction off, only walls and sprites use the straight-line distance. The floor and ceiling are always cast correctly, so the floor does not bow with the walls.
- Lighting is invented: a side shade for faces of constant y, a warm gradient up each wall, and exponential fog. None of it is physical.
- The drones are deliberately simple wanderers, not pathfinders. While the ground plan is open they hold still and cannot catch you, so studying the trick is never punished; in exchange you walk at half pace and the clock keeps running, so the plan is not a shortcut.

**The ground plan.** In split view the plan is a window about 8 tiles across around the player (about 40 px per tile on a laptop), not the whole 17 x 17 maze. An independent check found that at whole-maze scale the median ray was about 17 px long and the fan was a sliver. The plan shows only tiles that some ray has crossed or struck, and drones only while they are on screen, so it records what you have seen rather than giving away the maze. Unless you point at a column, the amber traced ray is column 41 (about 26 degrees left of centre), where the straight-line and straight-ahead distances differ by about 10%; at the centre column they are equal and the construction collapses to a line. The cue sheet works its sum (focal ÷ distance = height) from the numbers as printed, so it checks out with a calculator.

**What I checked, and how.** `node projects/corridor/tests/model.test.js` (plain Node, no dependencies) checks:
- (a) DDA hit distances against an exact reference: every wall tile treated as a closed unit box, intersected with the ray by the slab method, taking the first entry. 10,000 rays on five maps, one in ten exactly axis-aligned and the rest with directions of random length; all agree to 1e-9 with no exceptions (worst about 7e-15).
- (a) Also against a brute-force ray march (fixed 0.002-tile steps, refined by bisection) for 5,000 random rays across four maps. 4,999 agree to 1e-6; the one disagreement is a ray grazing a tile corner, where the march stepped over a sliver of wall thinner than its step. The test requires every disagreement to be of that kind: the DDA hit earlier, and within two steps of a tile corner. It also checks that each hit lies on the boundary of the struck tile.
- (b) A flat wall faced straight on, at 40, 66, 90 and 110 degrees: with correction on, all 320 columns have the same slice height. With it off, the centre is about 19% taller than the edges at 66 degrees, rising monotonically to the centre and matching the corrected height times cos(angle) column by column.
- (c) A 200,000-step random walk (with occasional lunges of up to 3 tiles) on three mazes never leaves the player's box inside a wall; 30,000 full game steps with random input do the same, and no drone ever stands in a wall.
- (d) The same seed gives the same maze, keys, exit and drone start points, and identical drone positions over 3,000 steps with the same input. Different seeds give different mazes.
- (e) The default level and 1,000 other seeds are solvable (every key and the tile in front of the exit reachable by breadth-first search), and a scripted player that follows shortest paths collects the three keys and wins the default level.
- The reveal: holding (plan open) halves walking speed, freezes the drones and prevents catches; the plan window always contains the player at 25 px per tile or more and stays inside the map; and the cue sheet's printed sum is correct for its printed operands (3,000 random views).
- Sprite projection (a sprite dead ahead lands on the centre column; one on the edge ray lands on the screen edge) and the zap test (hit ahead, miss off-axis, behind a wall, already dimmed, out of range).

In the browser I checked the page at desktop width and at 375 x 812 with touch emulation (no horizontal scroll, touch pad shown; with the trick open, the view, the pad and all four cues with the active cue's note fit in one 812 px screen, with the plan below), the split view, slow motion, the toggles, and the `?preview` card on its own and inside projects.html. One frame, including the ground plan, takes about 3 ms of script time on a laptop.

**What would change the conclusion.** If the brute-force march disagreed with the DDA away from tile corners, the grid walk would be wrong. If the corrected wall in check (b) were not flat, the slice heights would not be a faithful perspective projection, and the page's explanation of the fish-eye effect would be false.

## Sources

- Lode Vandevenne, "Raycasting" (Lode's Computer Graphics Tutorial), lodev.org/cgtutor/raycasting.html. The camera-plane formulation, DDA traversal and sprite depth-buffer approach.
- Fabien Sanglard, *Game Engine Black Book: Wolfenstein 3D* (2017). Background on how the original game drew its walls.
- id Software, *Wolfenstein 3D* (1992). The game this style of renderer is known from; no art or code from it is used here.
- Fonts: Abril Fatface (TypeTogether) and Cutive Mono (The Cutive Project Authors), SIL Open Font License 1.1, from Fontsource 5.2.7; licence in `fonts/OFL.txt`.
