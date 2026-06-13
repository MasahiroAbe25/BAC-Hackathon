# メモリーツリー(アイデンティティポスター)プロトタイプ

就活占いの診断結果を中心ノードにしたツリーが、自由入力やAIキャラ「ケン」との対話を通じてニョキニョキ育つプロトタイプです。

## 起動方法

```bash
npm install
npm run dev
# → http://localhost:5173
```

## ケン(LLM対話)を本物のAPIで動かす場合

```bash
export OPENROUTER_API_KEY=sk-or-...
npm run dev
```

LLMは OpenRouter 経由で `openai/gpt-4o-mini` を使用します(`OPENROUTER_MODEL` で変更可)。
APIキー未設定時は、ケンは定型質問のデモモードで動作し、対話のまとめはkuromoji.jsによるローカル解析で代替されます(デモ発表はキーなしでも成立します)。

## デモフロー

1. 起点画面で18診断から自分の「就活占い」結果を選ぶ → summary表示 → ツリー画面へ
2. 「✍️ 自分で書く」タブ: 覚えたこと・興味・弱点を書いて「もっと深掘りしてみる」→ kuromoji.jsでキーワード抽出 → Overlap coefficient(閾値0.5)でブランチ判定 → リーフ追加
3. どのブランチにも合わないトピックは外周にふわふわ浮遊
4. 「💬 ケンと話す」タブ: ケンの質問に答えて「まとめてもらう」→ LLMがトピック抽出 → 同じ判定処理でツリーに合流

## 構成

- `src/data/diagnoses.json` — 18診断データ
- `src/lib/tokenizer.ts` — kuromoji.js形態素解析(名詞抽出・複合語化・頻度ランキング)
- `src/lib/branchMatch.ts` — Overlap coefficientによるブランチ判定(共通処理)
- `src/lib/layout.ts` — d3-forceレイアウト(forceLink / forceCollide / forceRadial)。中心直下の3ブランチは `BRANCH_LAYOUT`(開始角・角度ステップ・半径・`gapPx`)で放射状に配置し、ノードの実サイズから矩形交点を求めて「見た目の線の長さ」を全方向で揃える
- `src/components/edges.tsx` — 全コネクター共通の直線エッジ `StraightConnector`(react-flow標準ベジェの波打ちを回避)
- `src/lib/ken.ts` — ケンの対話・要約(OpenRouter API + モックフォールバック)
- `vite.config.ts` — `/api/ken` ミドルウェア(APIキーをブラウザに出さないためのプロキシ)+ `/kuromoji/dict/*.dat.gz` を素のgzipとして返すミドルウェア(後述)
- `public/kuromoji/` — kuromoji.jsの辞書ファイル(node_modulesからコピー)

## kuromoji辞書の配信について

kuromoji.jsの辞書(`*.dat.gz`)は gzip 圧縮済みバイナリです。Viteのdev静的サーバーは `.gz` を見ると `Content-Encoding: gzip` を付けてしまい、ブラウザが自動解凍 → kuromojiが二重にgunzipして `invalid file signature` で失敗します。これを防ぐため、`vite.config.ts` のミドルウェアが `/kuromoji/dict/*.dat.gz` を `Content-Encoding` なし・`application/octet-stream` でそのまま返します。`vite.config.ts` を変更したらdevサーバーの再起動が必要です。
