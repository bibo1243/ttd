// Who the island's robots are: names and personalities. Pure data, kept
// apart from how robots are modelled (robots.js) and moved (stations.js).

// Each trait tunes how a robot spends its day:
//   speed   walking pace multiplier
//   legs    [min, max] stroll stops before heading for a train
//   wait    [min, max] seconds lingering at each stop
//   roam    how far it wanders from where it is
//   space   personal space kept from other robots
//   bounce  how springy its step is
//   social  chance of strolling over to a nearby robot for a chat
//   temper  chance of throwing itself down in a tantrum after missing a train
export const PERSONALITIES = [
  { key: 'lively', label: '活潑', desc: '走路蹦蹦跳跳，一刻也閒不下來', speed: 1.25, legs: [1, 3], wait: [0.6, 1.8], roam: 1.3, space: 0.22, bounce: 1.8, social: 0.25, temper: 0.9 },
  { key: 'lazy', label: '慵懶', desc: '慢吞吞的，能坐著就不站著', speed: 0.7, legs: [1, 2], wait: [3, 7], roam: 0.7, space: 0.22, bounce: 0.5, social: 0.1, temper: 0.4 },
  { key: 'curious', label: '好奇', desc: '喜歡到處探險，常走得很遠', speed: 1.05, legs: [3, 5], wait: [1, 3], roam: 1.9, space: 0.22, bounce: 1, social: 0.15, temper: 0.6 },
  { key: 'shy', label: '害羞', desc: '喜歡和別人保持一點距離', speed: 0.9, legs: [1, 3], wait: [1.5, 4], roam: 1, space: 0.42, bounce: 0.8, social: 0, temper: 0.3 },
  { key: 'social', label: '愛聊天', desc: '看到朋友就湊過去聊兩句', speed: 1, legs: [2, 4], wait: [2, 4], roam: 1, space: 0.18, bounce: 1.1, social: 0.7, temper: 0.6 },
  { key: 'hasty', label: '急性子', desc: '總是趕著去搭下一班車', speed: 1.35, legs: [0, 1], wait: [0.3, 1], roam: 0.8, space: 0.2, bounce: 1.3, social: 0.05, temper: 1 },
  { key: 'dreamy', label: '愛發呆', desc: '常常停下來看風景', speed: 0.8, legs: [1, 3], wait: [4, 9], roam: 1, space: 0.25, bounce: 0.7, social: 0.1, temper: 0.35 },
  { key: 'tidy', label: '一絲不苟', desc: '排隊一定站得整整齊齊', speed: 1, legs: [1, 2], wait: [1, 2.5], roam: 0.9, space: 0.26, bounce: 0.9, social: 0.1, temper: 0.5 },
];

const PREFIX = ['小', '阿'];
const CHARS = '波哲米豆蘋凱露奇光多妮福樂葵球星可鈴寶果宇糖布丸麻圓嘟皮桃莓栗瓜橘柚棉雲晴虹月泡卡丁咕嚕哈拉妞乖';

// A different name for each of the first ~180 residents.
export function residentName(i) {
  const n = CHARS.length;
  if (i < n * 2) return PREFIX[Math.floor(i / n)] + CHARS[i % n];
  const c = CHARS[(i * 7) % n];
  return c + c + (i >= n * 3 ? Math.floor(i / n) : '');
}

export function randomPersonality() {
  return PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
}

export const between = ([a, b]) => a + Math.random() * (b - a);
