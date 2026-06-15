# アイデンティティポスター

就活占いの診断結果を中心ノードに、あなたの「強み・成長ポイント・働き方」をマインドマップとして育てるWebアプリです。

テキストを書いて分析するか、AIキャラクター「ケン」と話すだけで、自分でも気づいていなかった特徴がツリーの枝として育っていきます。

---

## セットアップ

```bash
npm install
npm run dev
# → http://localhost:5173
```

---

## 環境変数

`.env` ファイルをプロジェクトルートに作成してください(`.env.example` をコピーして編集)。

**いずれか1つ以上設定するとAIモードで動作します。** 複数設定した場合は上から順に試行し、失敗したら次のプロバイダーへ自動フォールバックします。

| 変数名 | 説明 |
|---|---|
| `OPENROUTER_API_KEY` | [OpenRouter](https://openrouter.ai/) のAPIキー(推奨: 多数のモデルを1キーで利用可能) |
| `OPENROUTER_MODEL` | 使用モデル(省略時: `openai/gpt-4o-mini`)。カンマ区切りで複数指定可 |
| `OPENAI_API_KEY` | [OpenAI](https://platform.openai.com/api-keys) のAPIキー |
| `OPENAI_MODEL` | 使用モデル(省略時: `gpt-4o-mini`)。カンマ区切りで複数指定可 |
| `GROQ_API_KEY` | [Groq](https://console.groq.com/keys) のAPIキー(無料枠あり・高速) |
| `GROQ_MODEL` | 使用モデル(省略時: `llama-3.3-70b-versatile`)。カンマ区切りで複数指定可 |
| `MISTRAL_API_KEY` | [Mistral AI](https://console.mistral.ai/api-keys/) のAPIキー |
| `MISTRAL_MODEL` | 使用モデル(省略時: `mistral-small-latest`)。カンマ区切りで複数指定可 |
| `GEMINI_API_KEY` | [Google Gemini](https://aistudio.google.com/app/apikey) のAPIキー |
| `GEMINI_MODEL` | 使用モデル(省略時: `gemini-2.5-flash`)。カンマ区切りで複数指定可 |
| `ANTHROPIC_API_KEY` | [Anthropic](https://console.anthropic.com/settings/keys) のAPIキー |
| `ANTHROPIC_MODEL` | 使用モデル(省略時: `claude-3-5-haiku-20241022`)。カンマ区切りで複数指定可 |

**モデルのカンマ区切り指定例:**
```
GEMINI_MODEL=gemini-2.5-flash,gemini-2.0-flash,gemini-2.0-flash-lite
```
先頭から順に試し、レート上限などで失敗したら次のモデルを使用します。

**APIキーなしでも動きます。** その場合ケンは定型のデモ質問で応答し、会話まとめはローカルのテキスト解析で代替されます。

---

## デモフロー

1. **診断選択** — 18種の就活占い診断から自分の結果に近いものを1つ選ぶ
2. **ツリー表示** — 診断タイトルを中心に、「強み / 成長ポイント / 働き方」の3ブランチが展開される
3. **✍️ 自分で書く** — 覚えたこと・興味・弱点を自由記入 → 「ツリーを伸ばす」で分析
4. **💬 ケンと話す** — ケンの質問に答える → 「ツリーを伸ばす」でトピックをツリーに追加
5. どのブランチにも合わないトピックはツリー外周にふわふわ浮遊する
6. **📷 画像を保存** — サイドパネル下部のボタンでマインドマップをPNG画像として書き出す(ノード数に応じてサイズが変わる)
7. **🗺️ 整える** — ノードが増えて表示が乱れたらこのボタンで全ノードの位置を再計算してレイアウトをリセット(ツリーデータは保持)
8. **やり直す** — サイドパネル下部のボタンでツリーをリセット
8. ヘッダーの「← 性格タイプを選び直す」で診断選択画面に戻れる

---

## 主な機能

### データ永続化

ブラウザの `localStorage` にツリーデータ(ノード・座標)と選択中の診断IDを保存します。リロードしても作業中のマインドマップが復元され、ツリーが育った後に安心して画像出力できます。診断ごとに独立したスロットを持つため、複数の診断データを保持できます。

### 画像出力

サイドパネル下部の「📷 画像を保存」ボタンでマインドマップをPNG画像として書き出します。`html-to-image` ライブラリを使用し、React Flowの CSS transform を含む全レイヤー(背景グリッド・SVGエッジ・HTMLノード)を正確にキャプチャします。出力サイズはノードの配置範囲から自動計算され、コンテンツが少なければ小さく、多ければ大きい画像になります。

### レイアウト調整

グラフ表示エリアとサイドパネルの境界をドラッグして幅を動的に変更できます。パネル幅は最小 360px〜最大 50% の範囲で調整可能です。

### テキストマイニング

kuromoji.js による形態素解析で名詞・複合語を抽出し、カスタム用語辞書(就活・自己分析特化)と組み合わせて「推し活」「ガクチカ」「仮説検証」などの複合語も正確に認識します。

### ブランチ判定

Overlap coefficient(閾値 0.5)で入力タグと各ブランチのキーワードを照合し、最も関連するブランチにリーフノードを接続します。辞書語のカテゴリが一致する場合はスコアを補完します。

同一ブランチ内の既存リーフと類似度が 0.65 以上の場合は、そのリーフの**孫葉**として配置します(center → branch → leaf → sub-leaf の 4 階層構造)。孫葉は親リーフから約 140px の位置に forceLink で固定され、ブランチ内の空間を自然に分散します。

### AIキャラクター「ケン」

- ユーザーの診断結果と現在のツリー状況(どのブランチがまだ薄いか)をシステムプロンプトに注入
- 毎回の返答末尾に次の返答候補をボタンとして提示(`NEXT:[...]` 形式)
- OpenRouter → Gemini の順でフォールバック。両方アウトのときだけモックに切り替わる

### レイアウト

- 3ブランチは中心からの実サイズ(DOM計測)をもとに放射状に配置し、全方向で見た目の線の長さを均一化
- リーフ・孫葉・浮遊ノードは d3-force(forceLink / forceCollide / forceRadial / forceX・Y)で自動配置後、位置を固定
- リーフの目標半径はブランチごとの葉数に応じて動的に拡大(`max(240, 170 + 葉数 × 28)px`)し、多数のノードが重なるのを防止
- 孫葉は sectorX/Y 力を適用せず forceLink のみで親リーフ近傍に追従させる(sector 力を適用すると親リーフと同一円上に引き戻されるため除外)
- 「🗺️ 整える」ボタンは全固定位置をクリアして再シミュレーション(300 反復)を実行し、蓄積した位置の乱れを解消

---

## ファイル構成

```
src/
├── data/diagnoses.json      # 18診断データ
├── components/
│   ├── SelectScreen.tsx     # 診断選択画面
│   ├── TreeScreen.tsx       # メイン画面(react-flow + サイズ計測)
│   ├── MiningPanel.tsx      # テキスト入力パネル
│   ├── KenChatPanel.tsx     # ケンとのチャットUI
│   ├── nodes.tsx            # 各種ノードコンポーネント
│   ├── edges.tsx            # 直線エッジ(StraightConnector)
│   └── ExportButton.tsx     # 画像出力コントローラ(headless・ReactFlow内)
├── hooks/
│   └── useMemoryTree.ts     # ツリー状態管理・永続化
└── lib/
    ├── tokenizer.ts         # kuromoji.js 形態素解析
    ├── domainDictionary.ts  # カスタム用語辞書
    ├── branchMatch.ts       # ブランチ判定(Overlap coefficient)
    ├── layout.ts            # d3-force レイアウト計算
    ├── storage.ts           # localStorage 永続化ヘルパー
    ├── ken.ts               # ケンの対話・要約ロジック
    └── kenPersona.ts        # ケンのシステムプロンプト
```

---

## 技術メモ

### kuromoji辞書の配信

辞書ファイル(`*.dat.gz`)はgzip済みバイナリです。Viteの静的サーバーは `.gz` に `Content-Encoding: gzip` を付与するため、ブラウザが自動解凍 → kuromoji側で二重gunzipして失敗します。`vite.config.ts` の `kuromojiDictPlugin` がこれを回避し、`application/octet-stream` としてそのまま配信します。`vite.config.ts` を変更したらdevサーバーの再起動が必要です。

### APIプロキシ

`/api/ken` は `vite.config.ts` のサーバーサイドミドルウェアで処理されます。APIキーはサーバー側でのみ使用され、ブラウザに露出しません。

---

## カスタマイズ

- **ケンの人格・口調**: `src/lib/kenPersona.ts` の A〜D セクションを編集
- **モック質問の追加**: `src/lib/ken.ts` の `MOCK_QUESTIONS` 配列を編集
- **用語辞書の拡張**: `src/lib/domainDictionary.ts` の `DOMAIN_DICTIONARY` に追記
- **診断データの追加**: `src/data/diagnoses.json` に追記(branches の順序は `weapon → growth → workstyle` を維持)
- **カラー変更**: `src/styles.css` 冒頭の CSS変数を編集
