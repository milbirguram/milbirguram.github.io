# Animus

A browser workshop for Braitenberg vehicles, and a game of guessing a hidden wiring from behaviour. Page: `projects/animus/index.html`. Model: `model.js` (browser and Node). Tests: `tests/model.test.js`.

## What it’s for

To show two things Valentino Braitenberg made vivid in *Vehicles*. First, that we read purpose into very simple mechanism: a few wires look like fear or love. Second, his “law of uphill analysis and downhill invention”: building a behaviour from wiring is easy, but inferring the wiring from the behaviour is hard, and sometimes the behaviour does not contain the answer at all.

### Four wirings

Every vehicle has the same body: two light sensors on its nose and a motor on each wheel. Only the wiring differs. A wire runs either to the motor on its own side (straight) or to the motor on the far side (crossed). It either speeds that motor up as the light gets brighter (+), or slows it down from a steady cruising speed (−).

- **2a, straight +.** The wheel nearer the light spins faster, so the vehicle swings away, and it speeds up as it nears. Braitenberg’s word for it was fear.
- **2b, crossed +.** The far wheel spins faster, so it swings towards the light and speeds up into it. Aggression.
- **3a, straight −.** The near wheel slows, so it turns towards the light, and both wheels slow until it stops, facing it. Love.
- **3b, crossed −.** The far wheel slows, so it turns away, but it also slows near the light, lingers, and drifts off to another one. Explorer.

None of these machines has a goal, a map or a memory. Each wheel’s speed is a sum of two numbers. The fear and the love are in the person watching, which is exactly why the words are hard not to use.

The second tab runs the other way. A vehicle drives with its wiring hidden, and you work out what is inside from what it does. Building a vehicle takes two choices. Reading one back is a different kind of problem.

## How I know

**What is modelled.** Each vehicle is a two-wheeled robot steered by the difference between its wheel speeds. Its two sensors sit on the front corners of its nose, both facing forward. A sensor’s reading is the sum over lights of 1 / (1 + d²/k) × max(0, cos θ), where d is the distance to the light, θ is the angle between the sensor’s axis and the light, and k = 3000 (so a light is half as bright 55 units away; the arena is 800 by 500). Each wheel’s speed is a cruising speed of 60 plus the weighted readings of the sensors wired to it, clamped between 0 and 260, so a wheel never runs backwards. Time advances in fixed steps of 1/60 s; the screen only interpolates between steps. The floor wraps round like an old arcade screen, and each sensor sees the nearest copy of a light, so there are no corners to get stuck in. Workshop vehicles have a little seeded random wheel slip, proportional to speed; the guessing rounds have none. The explorer leans on that slip more than the others do. Without it, it reaches a second light in only 18 of 30 random arenas (26 of 30 with it): left alone, it tends to settle into a repeating path that passes one light, or none. The other three behave much the same with or without it.

**What is simplified.** No inertia, no friction, no collisions: vehicles drive through each other and through the lights. Lights are points and nothing casts shadows. On small screens the vehicles are drawn larger than their true size so they stay visible; the physics uses the true size. The connections are linear; Braitenberg’s later vehicles use curved, thresholded ones, which this page does not include. I first gave the sensors outward-splayed axes. With that, the explorer turned away from lights while still far off and rarely reached a second one, so the sensors now face straight ahead and the steering comes from their being a little apart.

**What I checked, and how.** The model lives in its own file and is tested headlessly in Node (`node projects/animus/tests/model.test.js`). The tests check the sensor formula against a hand calculation; that each classic vehicle shows its signature in a standard arena (2b comes within 15 units of the light; 2a, after its closest approach, is at least 120 units farther away four seconds later and was going faster near the light; 3a ends within 90 units, nearly stopped and facing it; 3b slows near lights and visits more than one); and that these signatures hold in at least 80% of 30 seeded random arenas. On the last run they held in 29 (fear), 26 (aggression), 27 (love) and 26 (explorer) of 30.

The starting places in the workshop and in the card preview were picked by a grid search so that each vehicle shows its character early, and the tests re-check them: in the default workshop, aggression rams a light by about 5 seconds, fear swerves away and never touches a light in three minutes, love comes to rest, and the explorer slows at one light, moves on and slows at the other, all within 12 seconds. The still shown when motion is reduced is taken at a moment the tests confirm already shows all four. A vehicle you release starts 120 to 170 units from a light and roughly facing it. Over 200 trial releases it showed its character within 15 to 20 seconds in 149 (fear), 160 (aggression), 192 (love) and 133 (explorer) cases, so a release that does nothing much is not rare, especially for the explorer; release another or move a light.

For every guessing round the tests simulate every wiring the controls can express and confirm that the score accepts exactly those whose path stays, on average, within 12 units of the hidden vehicle’s. They also confirm that no round accepts a wiring that is clearly different elsewhere (drifting more than 36 units from the truth in one of eight unrelated arenas), except round 4, which exists to show exactly that, and that no wiring sits close to the 12-unit line. A round only asks you to watch the speed if the hidden vehicle’s speed really changes by more than a quarter, and the hidden fear vehicle never charges into a light. Round 5 has a catch that the page states openly: with one wire exciting and the other inhibiting, the speed barely moves (by at most 11% there), and its mirror wiring (left sensor inhibiting the left wheel, right sensor exciting it) steers by exactly the same rule. Only a small difference in speed separates them, which the arena amplifies into different paths. If you pick the mirror, or any wiring that steers the same way, the result says so and shows how far each one’s speed moved. Finally they check that the same seed gives the same trajectory, number for number.

**What would change the conclusion.** The 12-unit threshold is a choice; a looser one would let more wirings count as the same. Sameness is only checked among the wirings the controls offer, not every possible circuit. Sensor geometry matters too: with forward-facing sensors, a mixed vehicle’s behaviour depends far more on which wheel is excited and which is inhibited than on which sensor drives which wheel, so some wirings that look different on paper come close in many arenas. A different body would make different wirings hard to tell apart, but the asymmetry between building and reading back would remain.

## Sources

- Valentino Braitenberg, *Vehicles: Experiments in Synthetic Psychology*. MIT Press, 1984. Vehicles 2 and 3, and the law of uphill analysis and downhill invention.
- Fritz Heider and Marianne Simmel, “An experimental study of apparent behavior”. *American Journal of Psychology* 57 (1944), 243–259. People watching moving shapes describe intentions and feelings.
- Daniel C. Dennett, *The Intentional Stance*. MIT Press, 1987. On predicting a system by treating it as if it had beliefs and desires.

## Look

The stage is drawn as a long exposure in a dark room: a graphite field with faint film grain, the lights as tungsten bulbs whose halo uses the same falloff as the sensors, and each toy robot carrying a lamp that paints its path. Streaks are blended additively, so a place a vehicle passes again, or lingers at, burns in brighter. Each wiring has its own lamp colour and its own streak pattern (2a broken, 2b one hot line, 3a beads, 3b twin rails), so colour is never the only cue. In the guessing rounds the hidden track is solid and the guess dashed, with a strobe flash every half second to show speed. Type: DM Mono by Colophon Foundry, SIL Open Font License 1.1, self-hosted in `fonts/` with `OFL.txt`.
