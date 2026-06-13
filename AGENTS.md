# AGENTS.md — アイデンティティポスター 改修ガイド

このドキュメントはAIエージェントがこのリポジトリを改修する際に参照するためのガイドです。
実装前の仕様書ではなく、**現在の実装を正確に把握した上で作業するための地図**として機能します。

---

## プロジェクト概要

**アイデンティティポスター**は、就活占いの診断結果を起点に、ユーザーの「強み・成長ポイント・働き方」を
マインドマップ形式で可視化するWebアプリです。

- ユーザーは18種の診断から1つを選び、ツリー画面に遷移する
- テキスト自由入力 または AIキャラクター「ケン」との対話によってトピックを入力できる
- トピックはkuromoji.jsで形態素解析 → Overlap coefficientでブランチ判定 → リーフノードとしてツリーに追加される
- どのブランチにも合わないトピックは外周に浮遊するノードとして表示される

**技術スタック**: React + Vite / TypeScript / react-flow / d3-force / kuromoji.js  
**LLM**: OpenRouter API(プライマリ) + Gemini API OpenAI互換エンドポイント(フォールバック)

---

## ファイル構成と責務

```
src/
├── App.tsx                  # 画面遷移管理(SelectScreen ↔ TreeScreen)
├── types.ts                 # 共有型定義(TreeNode, Diagnosis, TopicInput, DomainTermHit, Source)
├── styles.css               # 全スタイル。カラートークンはCSS変数で管理
│
├── data/
│   └── diagnoses.json       # 18診断データ。各診断は id/title/summary/branches[] を持つ
│                            # branches[].id は常に "weapon"/"growth"/"workstyle" の3つ固定
│
├── components/
│   ├── SelectScreen.tsx     # 診断選択画面
│   ├── TreeScreen.tsx       # メイン画面。react-flowのノード/エッジ組み立てとサイズ計測を担当
│   ├── MiningPanel.tsx      # テキスト自由入力パネル
│   ├── KenChatPanel.tsx     # ケンとの対話チャットUI
│   ├── nodes.tsx            # CenterNode / BranchNode / LeafNode / FloatingNode
│   └── edges.tsx            # StraightConnector(直線エッジ。ベジェの波打ち回避)
│
├── hooks/
│   └── useMemoryTree.ts     # ツリー状態管理。treeNodes/positions/addTopics を提供
│
└── lib/
    ├── tokenizer.ts         # kuromoji.js形態素解析 → TopicInput生成
    ├── domainDictionary.ts  # カスタム用語辞書(就活・自己分析特化の複合語)
    ├── branchMatch.ts       # Overlap coefficientによるブランチ判定
    ├── layout.ts            # d3-forceレイアウト計算 / branchPosition / boxRadiusAtAngle
    ├── ken.ts               # callKenApi / kenChat / kenSummarize / モックフォールバック
    └── kenPersona.ts        # ケンのシステムプロンプト一元管理
```

---

## 主要データフロー

### A. テキストマイニング経路(MiningPanel)

```
ユーザー入力テキスト
  → scanDomainTerms()        # domainDictionary.ts: カスタム辞書で最長一致
  → kuromoji.tokenize()      # 形態素解析で名詞抽出
  → 頻度マップ + 複合語結合 + ドメイン語の重み付け
  → TopicInput { label, tags, domainTerms? }
  → topicToNode()            # branchMatch.ts: Overlap係数でブランチ判定
  → addTopics()              # useMemoryTree.ts: d3-forceで配置 → fixedRef固定
```

### B. ケン対話経路(KenChatPanel)

```
ユーザーとのチャット
  → kenChat(diagnosis, messages, treeNodes)   # buildKenSystemPrompt でプロンプト組み立て
  → /api/ken プロキシ(vite.config.ts)
  → OpenRouter API → (失敗時) Gemini API → (両方失敗時) モックフォールバック
  → NEXT:[...] 行をパースしてサジェストボタン表示
  → 「まとめてもらう」 → kenSummarize() → JSON topics 抽出 → topicToNode() → addTopics()
```

### C. ブランチ判定ロジック(branchMatch.ts)

1. **Overlap coefficient**: `topic.tags` と各ブランチの `keywords` の重複割合を計算。閾値 `0.5` 以上のブランチ(最高スコア)に接続
2. **ドメイン辞書補完**: Overlapで閾値未満でも、`domainTerms[].category` がブランチの `category` と一致すればそのブランチに接続

---

## 重要な実装上の制約と注意点

### ノード配置の固定化(fixedRef)

`useMemoryTree.ts` の `fixedRef` は一度書き込まれた座標を上書きしない。
これによりノードを追加するたびに全体がリレイアウトされるのを防いでいる。

**注意**: `addTopics` は `getSizes()` を呼んでサイズ情報を読む。`TreeScreen` では
`sizesRef.current` をレンダー中に同期更新しているため、`addTopics` 呼び出し時は
常に最新サイズが参照される。`nodeSizes.size === 0`(未計測)の場合は `handleTopics`
がガードしてスキップする。

### ブランチの角度は配列順依存

`branchAngle(index)` はブランチの配列インデックスから角度を計算する。
現在の `diagnoses.json` は全18診断で `[weapon, growth, workstyle]` の順が固定されているが、
新しい診断を追加する場合はこの順序を守ること。順序が変わると角度(レイアウト)がずれる。

### APIフォールバック順序

```
OpenRouter(任意エラー) → Gemini → 503(api_limit_exceeded_no_fallback) → クライアント側でモック
```

- `vite.config.ts`: OpenRouterが非2xx → Geminiへ。Geminiも失敗 → 503
- `ken.ts`: 503かつ `error === "api_limit_exceeded_no_fallback"` → `throw`(警告ログ) → モック
- `ken.ts`: 503かつ `error === "no_api_key"` → `null` → サイレントにモック

### kuromoji辞書の二重gunzip問題

`public/kuromoji/*.dat.gz` はViteの静的サーバーが `Content-Encoding: gzip` を付与してしまうため、
`kuromojiDictPlugin`(vite.config.ts)がリクエストを横取りして `application/octet-stream` で返す。
`vite.config.ts` を変更した場合は `devserver` の再起動が必須。

---

## 拡張・チューニングの方法

### ケンの人格・口調を変える

`src/lib/kenPersona.ts` の A〜D セクションを編集する。ファイル冒頭のコメントに各セクションの
説明がある。`buildKenSystemPrompt()` がこれらを自動で組み立てるため、ここだけ触れば良い。

### モックフォールバックの質問を変える

`src/lib/ken.ts` の `MOCK_QUESTIONS` 配列を編集する。配列の最後の要素が
「まとめてもらうボタン」への誘導になるよう維持すること。

### ドメイン辞書にキーワードを追加する

`src/lib/domainDictionary.ts` の `DOMAIN_DICTIONARY` 配列に `{ term, category?, weight? }` を追加する。
- `category` をブランチの `category`(強み / 成長ポイント / 働き方 / 興味 など)と一致させると
  ブランチ判定の補完に使われる
- `weight` は頻度ランキングでの重み(省略時1)

### 診断データを追加・変更する

`src/data/diagnoses.json` を編集する。
- `branches` の順序は `[weapon, growth, workstyle]` を維持すること(角度依存)
- `branches[].category` は `branchMatch.ts` のドメイン辞書補完マッチに使われる

### カラー・スタイルを変える

`src/styles.css` 冒頭の CSS変数(`--primary`, `--primary-dark`, `--primary-light` など)を変更する。

---

## 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `OPENROUTER_API_KEY` | 任意 | OpenRouter APIキー。未設定でもデモモードで動作する |
| `OPENROUTER_MODEL` | 任意 | 使用モデル(デフォルト: `openai/gpt-4o-mini`) |
| `GEMINI_API_KEY` | 任意 | GeminiフォールバックAPIキー。OpenRouter障害時に使用 |

`.env` ファイルが最優先で読まれる(シェル環境変数より優先)。

---

## 作業時のチェックリスト

改修を行う前に以下を確認すること:

- [ ] `diagnoses.json` の branches 順序に変更がないか確認する(ブランチ角度に影響)
- [ ] `nodeSizes.size === 0` のガードが機能する状況を壊していないか確認する
- [ ] APIフォールバック順序(`vite.config.ts` と `ken.ts`)が整合しているか確認する
- [ ] `kenPersona.ts` のシステムプロンプトに `NEXT:[...]` の出力指示が含まれているか確認する
  (KenChatPanel がこの形式に依存してサジェストボタンを生成する)
- [ ] kuromoji辞書プラグインに触れた場合、devサーバー再起動をドキュメントに明記する
