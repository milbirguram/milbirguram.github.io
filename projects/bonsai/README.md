# Garden

## What it is for

Make care begin with observing a particular tree rather than repeating the same routine. A visitor tends, positions and shapes a small virtual garden, discovers species-specific rhythms and sees that seasonal leaf loss is not always illness.

## How it works

The garden starts with a juniper, Japanese maple and Ficus; the nursery also offers dwarf jade and allows up to six trees. Four species have different moisture loss, drought/saturation sensitivity, temperature tolerance, placement needs and seasonal behaviour. The interface offers watering, light feeding, selective new-growth trimming, simulated repotting, fitting/removing wire and a gentle trunk-bend control. Wire is visible and can eventually damage vigour if forgotten. Soil darkens after watering; foliage responds to pruning and regrowth; maple foliage changes colour in autumn and disappears during winter rest. A tree selector and keyboard camera rotation provide alternatives to selecting objects on the 3D canvas.

Time advances only through **Let a day pass**. There is no unattended decline, background clock or claim of real-time horticulture. Each season is 30 simulated days. Moisture, nutrient, growth, vigour, root-space and recovery rates are deliberately compressed design parameters, not measurements or a recipe for caring for real plants. Each percentage describes a simulation state, not an observable laboratory metric. Trees retain a minimum recoverable vigour; good conditions can slowly recover a stressed plant. Nutrient deprivation pauses growth and slows recovery rather than trapping a weak tree behind its feeding restriction. Landscape hardiness is not equivalent to exposed bonsai-root hardiness.

Ficus microcarpa and Portulacaria afra favour the warm glasshouse; they do not require temperate winter dormancy. Juniper and maple need outdoor seasonal conditions. Maple favours sheltered summer exposure and can dry more quickly. Dwarf jade stores water and is particularly sensitive to repeated saturation. The pruning tool means light new-growth trimming, not a heavy structural cut; it retains foliage, particularly on juniper. Simulated root-work windows distinguish warm growers from temperate trees. The care sources provide qualitative direction; precise thresholds and timing are ours. Climate, hemisphere, cultivar, substrate, pot size and actual condition would change real advice.

Three.js 0.186.1 renders original seeded procedural trees, branching curves, instanced foliage, ceramic pots, moss, benches and a softly lit conservatory. No downloaded tree models, textures or photographs are used. Both `three.module.js` and `three.core.js` are vendored with the MIT licence, with no runtime CDN. Camera movement and water particles stop with `Kit.onPlay` and reduced motion. A simple SVG fallback leaves the care interface usable without WebGL2. The preview uses a fresh garden, never the visitor's stored garden, and makes no storage writes.

Regular gardens persist locally in browser storage. Export/import provides a backup and moves gardens between browsers. Clearing site data can remove a garden. Imports validate species, finite bounded states, counters and action dates. The journal is capped, as is the 30-day trace for each tree.

Run `node projects/bonsai/tests/run-all.js`. It checks four-species behaviour across 800 simulated care days, bounded state, cold stress, inappropriate indoor placement, drought resilience, dormancy, seasonal repotting restrictions, wire/shape persistence, deterministic restoration and a weak-tree recovery path. Browser QA checks watering/day advancement, adoption, shaping, persistence, narrow layouts, previews and console output. These checks validate the model as designed; they do not establish horticultural predictive accuracy.

## Sources and aesthetic references

- [NC State Extension: Ficus microcarpa](https://plants.ces.ncsu.edu/plants/ficus-microcarpa/) and [Juniperus procumbens](https://plants.ces.ncsu.edu/plants/juniperus-procumbens/).
- [RHS: Acer palmatum](https://www.rhs.org.uk/plants/225/acer-palmatum/details) and [bonsai guidance](https://www.rhs.org.uk/plants/types/trees/bonsai).
- [Wisconsin Extension: Portulacaria afra](https://hort.extension.wisc.edu/articles/elephant-bush-portulacaria-afra/).
- [Chicago Botanic Garden: bonsai care](https://www.chicagobotanic.org/plant-information/care-tips-bonsai).
- [Bonsai Empire: juniper](https://www.bonsaiempire.com/tree-species/juniper) — living foliage and selective pruning.
- [Three.js](https://threejs.org/) and its open-source instancing/shadow examples informed the technical rendering approach. The visual composition is original: a quiet conservatory, glazed pots, moss, exposed branching and changing canopies; no third-party artwork is claimed.
