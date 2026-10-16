# 迷你交通大亨

全 3D 網頁版交通運輸大亨模擬遊戲（原型）。目前有一列 Q 版低多邊形蒸汽火車，拖著可增減的車廂在小島軌道上行駛。

## 開發

```bash
npm install
npm run dev      # 開發伺服器
npm run build    # 輸出到 dist/
```

## 結構

- `src/main.js`：場景、燈光、相機與操作面板
- `src/track.js`：封閉軌道（道碴、枕木、鋼軌）與沿軌道取點
- `src/train.js`：火車頭、車廂、輪子與連桿動畫、蒸汽
- `src/world.js`：小島、樹、房子、車站、雲

技術：Three.js + Vite。
