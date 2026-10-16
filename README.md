# 迷你交通大亨

全 3D 網頁版交通運輸大亨模擬遊戲（原型）。小島上有一條環狀鐵路和 3 個車站，可以切換蒸汽火車、高鐵、路面電車三種車種。

機器人乘客會在各站出現，身體顏色代表要去的車站。列車會自動進站停靠，讓乘客下車、上車，每送達一位乘客就依搭乘距離賺取車資。

## 開發

```bash
npm install
npm run dev      # 開發伺服器
npm run build    # 輸出到 dist/
```

## 結構

- `src/main.js`：場景、燈光、相機與操作面板
- `src/track.js`：封閉軌道（道碴、枕木、鋼軌）與沿軌道取點
- `src/train.js`：列車編組、車種設定（容量、速度）、蒸汽
- `src/parts.js`：共用材質、輪軸、車身放樣（loft）工具
- `src/steam.js`：蒸汽火車頭與客車廂
- `src/modern.js`：高鐵與路面電車
- `src/stations.js`：車站、機器人乘客、上下車與收入
- `src/world.js`：小島、樹、房子、雲

技術：Three.js + Vite。
