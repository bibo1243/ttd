import { makeCar } from './cars.js';
import { makeBus } from './bus.js';
import { makeBicycle, makeScooter } from './bikes.js';

// Every kind of road vehicle the player can put on the roads. Custom types
// the player adds are a base model plus a name and a colour.
//   speed      cruising speed (world units per second)
//   seats      how many riders it carries, driver included
//   colors     paint jobs picked at random when none is chosen
export const VEHICLE_MODELS = {
  sedan: {
    label: '轎車',
    icon: '🚗',
    speed: 2.3,
    colors: [0xe8574a, 0x3a86d4, 0xf2f0ea, 0x2f3440, 0x56b38a, 0xf2a541, 0x9b7fd1, 0xe8789a],
    build: (color) => makeCar('sedan', color),
  },
  taxi: {
    label: '計程車',
    icon: '🚕',
    speed: 2.5,
    colors: [0xf6c32c],
    build: (color) => makeCar('taxi', color),
  },
  van: {
    label: '小貨車',
    icon: '🚚',
    speed: 2.0,
    colors: [0x3a86d4, 0xe8574a, 0x2e8b6e, 0xf2a541],
    build: (color) => makeCar('van', color),
  },
  bus: {
    label: '公車',
    icon: '🚌',
    speed: 1.7,
    colors: [0x2e8b6e, 0x3a6fd4, 0xd9483b, 0xe8a12e],
    build: (color, opts) => makeBus(color, opts?.route ?? '1'),
  },
  scooter: {
    label: '機車',
    icon: '🛵',
    speed: 2.4,
    colors: [0x4a90c8, 0xe8574a, 0xf2f0ea, 0x56c2c2, 0xf4d35e, 0x2f3440, 0xe8789a],
    build: (color) => makeScooter(color),
  },
  bicycle: {
    label: '自行車',
    icon: '🚲',
    speed: 1.1,
    colors: [0x2e8b6e, 0xe8574a, 0x3a86d4, 0xf2a541, 0xe8789a, 0x2f3440],
    build: (color) => makeBicycle(color),
  },
};

export const pickColor = (key) => {
  const c = VEHICLE_MODELS[key].colors;
  return c[Math.floor(Math.random() * c.length)];
};

export function buildVehicle(key, color = pickColor(key), opts) {
  const v = VEHICLE_MODELS[key].build(color, opts);
  v.model = key;
  v.color = color;
  return v;
}
