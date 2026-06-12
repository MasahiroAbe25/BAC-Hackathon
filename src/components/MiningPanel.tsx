import { useState } from "react";
import type { TopicInput } from "../types";
import { mineText } from "../lib/tokenizer";

interface Props {
  onTopics: (topics: TopicInput[]) => void;
}

export default function MiningPanel({ onTopics }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastTopic, setLastTopic] = useState<TopicInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const topic = await mineText(text);
      if (!topic) {
        setError("キーワードが見つからなかったよ。もう少し具体的に書いてみて!");
      } else {
        setLastTopic(topic);
        onTopics([topic]);
        setText("");
      }
    } catch (err) {
      console.error(err);
      setError("解析エンジンの読み込みに失敗しちゃった…リロードしてみてね。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mining-form">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="最近覚えたこと、興味があること、ちょっと苦手なこと…なんでも書いてみよう"
      />
      <div className="hint">#覚えたこと #興味 #弱点 → ツリーがニョキニョキ育つよ</div>
      <button className="primary-button" onClick={analyze} disabled={busy || !text.trim()}>
        {busy ? "伸ばし中…" : "ツリーを伸ばす 🌱"}
      </button>
      {error && <div className="mining-result">{error}</div>}
      {lastTopic && !error && (
        <div className="mining-result">
          <strong>「{lastTopic.label}」</strong> を追加したよ!
          <div className="tags">
            {lastTopic.tags.map((tag) => (
              <span key={tag} className="tag-chip">
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
