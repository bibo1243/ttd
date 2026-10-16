// Feature modules (shops, homes, roads, airport...) plug in here instead of
// editing main.js. A module is an object:
//
//   {
//     name: 'roads',
//     init(game) {},          // once, after the world, rail network and residents exist
//     update(dt, time) {},    // every simulation step (also during fastForward)
//     frame(dt) {},           // every rendered frame (camera, visual-only work)
//   }
//
// `game` holds the shared pieces:
//   scene, camera, renderer, controls, world (scenery, obstacles),
//   network (rails), passengers (stations, trains, robots, money),
//   builder (build toolbar),
//   look (render.js: look.onTime((night) => ...) to light windows at night,
//         look.addLamp(object, { color, intensity, bulb }) for warm lamps), and
//   money: { get(), spend(n) -> bool, earn(n), float(text, position) }
//   tools: addTool({ id, icon, label, onSelect }) adds a toolbar button.
//
// Register a module by adding it to MODULES below.

import { homes } from './homes/index.js';

export const MODULES = [homes];

export function register(mod) {
  MODULES.push(mod);
}
