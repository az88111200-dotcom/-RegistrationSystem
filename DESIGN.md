---
name: 少年培力園 活動報名系統
description: 航班看板與登機證——Pilot.Cafe 的活動報名與場地借用
colors:
  night-navy: "#0b1550"
  board-hover: "#13206a"
  cobalt-deep: "#1a2fb0"
  cobalt: "#2242e0"
  cobalt-bright: "#3a5bff"
  cobalt-mist: "#aab6f5"
  cobalt-wash: "#e8ecff"
  runway-amber: "#ffc400"
  runway-amber-deep: "#e9ae00"
  amber-ink: "#1f1600"
  amber-wash: "#fff5cc"
  standby-sky: "#2aaef0"
  standby-sky-deep: "#0a5c9e"
  standby-wash: "#e1f3fd"
  full-red: "#d92638"
  red-wash: "#fde7ea"
  ok-green: "#0a7a48"
  ok-wash: "#dff5e9"
  go-green: "#19c37d"
  ink: "#0e1338"
  ink-soft: "#434a72"
  ink-faint: "#666d94"
  line: "#cdd3e8"
  line-strong: "#8f97bf"
  page: "#f0f2f9"
  page-sunk: "#e6e9f4"
  card: "#ffffff"
  board-soft: "#b4bdea"
typography:
  headline:
    fontFamily: "B612, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 4.4vw, 2.15rem)"
    fontWeight: 800
    lineHeight: 1.35
  title:
    fontFamily: "B612, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "1.12rem"
    fontWeight: 800
  body:
    fontFamily: "B612, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "B612, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 700
  board-numeral:
    fontFamily: "B612, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
rounded:
  badge: "3px"
  sm: "5px"
  md: "8px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.card}"
    rounded: "{rounded.sm}"
    padding: "11px 18px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-deep}"
  button-main-action:
    backgroundColor: "{colors.runway-amber}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.sm}"
    padding: "14px 22px"
  button-ghost:
    backgroundColor: "{colors.card}"
    textColor: "{colors.cobalt-deep}"
    rounded: "{rounded.sm}"
  tab-selected:
    backgroundColor: "{colors.night-navy}"
    textColor: "{colors.card}"
    rounded: "{rounded.sm}"
  board:
    backgroundColor: "{colors.night-navy}"
    textColor: "{colors.card}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "24px 22px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "11px 12px"
---

# Design System: 少年培力園 活動報名系統

全部的樣式都在 `public/assets/style.css`（一份檔案、手機優先），變數定義在檔案最上面的 `:root`。

## Overview

**Creative North Star:「航班看板與登機證」**

培力園的英文名字是 Pilot.Cafe，標誌是一台小飛機。整個網站借用機場那一套「一眼看懂」的資訊設計：
活動清單是一面深藍色的航班看板（日期、活動、狀態），活動頁的資訊卡是一張登機證（左邊票根放日期、
中間一條打孔線、右邊是一格一格的欄位），每一頁最上面有一條左右拉滿的鈷藍色標題。

這是給少年報名、社工管理用的工具，所以表現力放在「精準」：顏色各有工作、狀態用實心色塊、
數字對齊、轉角都是小方角。不靠淡淡的底色、柔和陰影、膠囊形按鈕。

**Key Characteristics:**
- 深藍看板＋黃色數字是全站的記憶點；後台的總數列（`.stat-grid`）也是同一套。
- 白底的頁首只放培力園的整條標誌（彩色字、透明底，只能放在白底上），標誌上的紫、橘、綠不拿來當介面顏色。
- 每一頁的文字內容不動；設計只改外觀。

## Colors

冷色的藍當底、暖色的黃當重點，狀態色各管一件事。

### Primary
- **夜航藍** (#0b1550)：看板、頁尾、選中的分頁、表頭下面那條線、後台計數列。最深的底。
- **鈷藍** (#2242e0)：每一頁最上面的標題帶、連結、一般按鈕、輸入框的焦點。
- **淡鈷藍** (#e8ecff)：表頭底色、選中的選項、行事曆上可報名的活動。

### Secondary
- **跑道黃** (#ffc400)：最主要的動作（報名、預約、查詢我的報名）、看板與票根上的日期數字、「今天」。
  黃底上的字一律用深色 (#1f1600)，不用白字。

### Tertiary（狀態）
- **開放綠** (#19c37d)：只出現在深藍看板上的「開放報名」。淺底上的成功訊息用 #0a7a48 配 #dff5e9。
- **候補天藍** (#2aaef0)：額滿但還收候補。
- **額滿紅** (#d92638)：已額滿、錯誤、「報名不等於錄取」的紅框提醒。
- **截止／結束**：不上色，灰藍字加細框。

### Neutral
- **墨藍** (#0e1338)：內文。次要 #434a72，說明小字 #666d94。
- **頁面底** (#f0f2f9)、**卡片** (#ffffff)、**線** (#cdd3e8)、輸入框的框 (#8f97bf)。

### Named Rules
**顏色要有工作。** 黃色只給最主要的動作和看板上的數字；一個畫面上不要兩顆黃色按鈕搶同一件事。
**藍底上的重點字用 #ffd54a。** #ffc400 放在鈷藍上對比只有 4.49:1，不夠。
**不用左邊色帶。** 狀態用整塊底色加細框（行事曆、借用表都是），不用粗的彩色左邊線。

## Typography

**字體：** 英數字用 B612（為飛機駕駛艙儀表設計的字體，自己放在 `public/assets/fonts/`，SIL OFL 授權），
中文用系統字（PingFang TC／Noto Sans TC／Microsoft JhengHei）。

**Character:** B612 的數字寬而清楚，日期、時間、人數一眼就讀得出來；中文不另外載字型，手機上才快。

### Hierarchy
- **Headline**（800，clamp(1.6rem, 4.4vw, 2.15rem)，行高 1.35）：每一頁的標題，白字放在鈷藍帶上。
- **Title**（800，1.12rem）：區塊標題，下面一條 2px 夜航藍的線。
- **Body**（400，16px，行高 1.7）：內文，一行不超過約 62 個字寬。
- **Label**（700，0.8rem）：狀態標籤、登機證上的欄位名稱。
- **看板數字**（B612 700，1.75rem；票根 2.5rem）：日期。

數字一律 `font-variant-numeric: tabular-nums`。標題上面不放小字標語。

## Layout

- 內容欄 `.wrap` 880px；表格多的頁面 `.wrap-wide`／`.wrap-cal` 1240px，頁首頁尾跟著一樣寬。左右留 16px。
- 頁面標題帶用 `box-shadow: 0 0 0 100vmax` 往兩邊拉滿，內容仍對齊中間那一欄。
  標題是 `main` 的第一個元素時自動套用；包在別的容器裡的加 `page-head-band`。
- 斷點：520px（看板列、登機證改直排）、640px（頁首標誌置中）、720px（表單兩欄）、900px（行事曆改月曆）。
- 手機優先；少年多半用手機報名，按鈕和選項都要按得到（選項高度約 44px）。

## Elevation & Depth

平的。區塊用 1px 的線和底色分層，不用陰影。陰影只給浮在畫面上的東西：

- **浮層** (`box-shadow: 0 14px 36px rgba(11, 21, 80, .2)`)：對話框、頁首「更多」的下拉面板。

## Shapes

- 轉角小而方：卡片、看板 8px；按鈕、輸入框、選項 5px；狀態標籤 3px。不用膠囊形（999px）。
- 登機證的打孔線是 2px 的虛線，其他地方的虛線只用在「可選、暫時」的東西（草稿說明、設備清單）。

## Components

- **看板** `.activity-list` > `.activity-card`：一個活動一列。左邊 `.date-chip`（黃色日、灰藍月份），
  中間名稱與時間地點，右邊狀態。已結束／截止／額滿（不收候補）的列字變淡、日期不再是黃色。
  「查看更多」與空白狀態都接在同一面看板裡。
- **登機證** `.card.pass`：`.pass-stub`（深藍票根、黃色日期）＋ `.pass-main`（`dl.kv`，每一對包在 `div` 裡，
  欄位名稱在上、內容在下；第一格日期佔一整行）。
- **按鈕**：`.btn` 鈷藍；`.btn-sun` 跑道黃（一個畫面一顆）；`.btn-ghost` 白底藍框；`.btn-danger` 白底紅字。
  鈷藍標題帶上的 `.btn-ghost` 自動變成白框透明底。
- **分頁** `.tab`：方角按鈕，選中的是夜航藍實心。
- **表格**：表頭淡鈷藍、下面 2px 夜航藍線；滑過整列變淡鈷藍；姓名欄可凍結。
- **提示** `.notice-*`：整圈細框加淡底色。最要緊的（報名≠錄取）白底紅框紅字。
- **總數列** `.stat-grid`：夜航藍一整條，黃色數字、灰藍說明。
- **查詢我的報名** `.my-entry`：整條跑道黃，可以整塊點。
- **焦點**：3px 鈷藍外框；在深藍或鈷藍底上改成黃色。

## Do's and Don'ts

- Do：新的清單型資訊優先考慮接進看板的樣子（深藍列、黃色數字、實心狀態）。
- Do：顏色都用 `:root` 的變數，不要在別處寫死新的顏色。
- Don't：不要把標誌放到有顏色的底上；頁首維持白底。
- Don't：不要用膠囊形、漸層字、柔和陰影的卡片、粗的彩色左邊線、表情符號當圖示（資料裡本來就有的表情符號不算）。
- Don't：不要改頁面上的文字內容；外觀調整不動文案。
