// Goods and the shop types that make them. Together they form a closed loop:
//
//   回收站 ─堆肥→ 農場 ─小麥/牛奶→ 麵包坊 ─麵包→ 咖啡廳 / 雜貨店 ─(賣給居民)→ $
//     ↑           │蔬果──────────────────────────→ 雜貨店
//     │           └─需要工具
//   垃圾 ← 咖啡廳 / 雜貨店 / 家具行
//     │
//     └─廢鐵→ 鐵工坊 ←礦石─ 礦場（需要工具）
//                 ↑ ←木材─ 林場（需要工具）
//                 └─工具→ 農場 / 礦場 / 林場 / 家具行
//   林場 ─木材→ 家具行 ─家具→ $
//
// Every retail sale leaves 垃圾 behind, which the recycling centre turns back
// into 堆肥 for the farm and 廢鐵 for the forge, so nothing in the chain needs
// a supply from outside the island once it is running.

export const GOODS = {
  compost: { label: '堆肥', icon: '🌱', color: 0x7a5a3a },
  wheat: { label: '小麥', icon: '🌾', color: 0xe9c25a },
  milk: { label: '牛奶', icon: '🥛', color: 0xf6f4ee },
  veg: { label: '蔬果', icon: '🥕', color: 0xf08a3c },
  bread: { label: '麵包', icon: '🍞', color: 0xd99a52 },
  wood: { label: '木材', icon: '🪵', color: 0xa86f42 },
  ore: { label: '礦石', icon: '🪨', color: 0x8d96a3 },
  scrap: { label: '廢鐵', icon: '🔩', color: 0x9aa3ad },
  tools: { label: '工具', icon: '🔧', color: 0x4a90c8 },
  furniture: { label: '家具', icon: '🛋️', color: 0xc9774e },
  trash: { label: '垃圾', icon: '🗑️', color: 0x6b8f5a },
};

// in / out are per production cycle; cycle is seconds of game time.
// `boost` supplies are optional: without them the shop works 2.5x slower,
// so the loop can always restart from nothing.
// `sell` turns that many outputs into money each cycle (retail shops);
// `trash` is litter produced per sale; `porters` robots carry the output.
export const SHOP_TYPES = {
  farm: {
    porters: 2,
    label: '農場',
    icon: '🚜',
    cost: 450,
    size: [3.2, 2.6],
    cycle: 9,
    boost: { compost: 1, tools: 0.2 },
    out: { wheat: 2, milk: 2, veg: 1 },
    starter: { compost: 3, tools: 1 },
    desc: '用堆肥種小麥、蔬果，養乳牛產牛奶。',
  },
  lumber: {
    porters: 2,
    label: '林場',
    icon: '🌲',
    cost: 300,
    size: [2.4, 2],
    cycle: 8,
    boost: { tools: 0.2 },
    out: { wood: 3 },
    starter: { tools: 1 },
    desc: '伐木製材，產出木材。',
  },
  mine: {
    label: '礦場',
    icon: '⛏️',
    cost: 380,
    size: [2.4, 2.2],
    cycle: 9,
    boost: { tools: 0.25 },
    out: { ore: 2 },
    starter: { tools: 1 },
    desc: '從山洞開採礦石。',
  },
  forge: {
    porters: 2,
    label: '鐵工坊',
    icon: '⚒️',
    cost: 520,
    size: [2.4, 2],
    cycle: 10,
    in: { ore: 1, wood: 1 },
    subs: { ore: 'scrap' }, // recycled scrap iron can stand in for ore
    out: { tools: 2 },
    starter: { ore: 2, wood: 2 },
    desc: '把礦石或廢鐵配上木柄，打造工具。',
  },
  bakery: {
    label: '麵包坊',
    icon: '🥐',
    cost: 360,
    size: [2.2, 1.8],
    cycle: 7,
    in: { wheat: 2, milk: 1 },
    out: { bread: 3 },
    desc: '小麥加牛奶烤成麵包。',
  },
  cafe: {
    label: '咖啡廳',
    icon: '☕',
    cost: 400,
    size: [2.2, 2.2],
    cycle: 8,
    in: { bread: 1, milk: 1 },
    sell: { price: 60, trash: 1 },
    desc: '把麵包和牛奶做成早午餐賣給居民。',
  },
  grocery: {
    label: '雜貨店',
    icon: '🛒',
    cost: 380,
    size: [2.4, 2],
    cycle: 7,
    in: { veg: 1, bread: 1 },
    sell: { price: 45, trash: 1 },
    desc: '販賣蔬果和麵包給居民。',
  },
  furniture: {
    label: '家具行',
    icon: '🪑',
    cost: 480,
    size: [2.4, 2],
    cycle: 12,
    in: { wood: 2, tools: 0.5 },
    sell: { price: 160, trash: 1 },
    desc: '用木材和工具做家具賣給居民。',
  },
  recycle: {
    porters: 2,
    label: '回收站',
    icon: '♻️',
    cost: 340,
    size: [2.4, 2],
    cycle: 8,
    in: { trash: 2 },
    out: { compost: 2, scrap: 1 },
    starter: { trash: 2 },
    desc: '把垃圾分類成堆肥和廢鐵，讓產業鏈循環。',
  },
};

// The demo industry: a shopping street north of the demo rail branch
// (two rows facing each other) and the mine and recycling yard south of it.
export const DEMO_LAYOUT = [
  ['farm', -5.6, 2.7, 0],
  ['bakery', -1.9, 2.9, 0],
  ['cafe', 1.6, 2.9, 0],
  ['grocery', 5.1, 2.9, 0],
  ['lumber', -5.4, 7.0, Math.PI],
  ['forge', -1.6, 7.0, Math.PI],
  ['furniture', 2.3, 7.0, Math.PI],
  ['mine', -3.2, -5.9, 0],
  ['recycle', 2.8, -5.9, 0],
];
