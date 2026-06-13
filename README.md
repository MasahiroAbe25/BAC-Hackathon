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

| 変数名 | 説明 |
|---|---|
| `OPENROUTER_API_KEY` | OpenRouter APIキー。未設定でもデモモードで動作します |
| `OPENROUTER_MODEL` | 使用モデル(省略時: `openai/gpt-4o-mini`) |
| `GEMINI_API_KEY` | GeminiフォールバックAPIキー。OpenRouterに障害・制限が発生したときに自動切り替えされます |

**APIキーなしでも動きます。** その場合ケンは定型のデモ質問で応答し、会話まとめはローカルのテキスト解析で代替されます。

---

## デモフロー

1. **診断選択** — 18種の就活占い診断から自分の結果に近いものを1つ選ぶ
2. **ツリー表示** — 診断タイトルを中心に、「強み / 成長ポイント / 働き方」の3ブランチが展開される
3. **✍️ 自分で書く** — 覚えたこと・興味・弱点を自由記入 → 「ツリーを伸ばす」で分析
4. **💬 ケンと話す** — ケンの質問に答える → 「ツリーを伸ばす」でトピックをツリーに追加
5. どのブランチにも合わないトピックはツリー外周にふわふわ浮遊する
6. **📷 画像を保存** — サイドパネル下部のボタンでマインドマップをPNG画像として書き出す(ノード数に応じてサイズが変わる)
7. **やり直す** — サイドパネル下部のボタンでツリーをリセット
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

### AIキャラクター「ケン」

- ユーザーの診断結果と現在のツリー状況(どのブランチがまだ薄いか)をシステムプロンプトに注入
- 毎回の返答末尾に次の返答候補をボタンとして提示(`NEXT:[...]` 形式)
- OpenRouter → Gemini の順でフォールバック。両方アウトのときだけモックに切り替わる

### レイアウト

- 3ブランチは中心からの実サイズ(DOM計測)をもとに放射状に配置し、全方向で見た目の線の長さを均一化
- リーフ・浮遊ノードは d3-force(forceLink / forceCollide / forceRadial)で自動配置後、位置を固定

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
