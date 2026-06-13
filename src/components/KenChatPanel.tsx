import { useEffect, useRef, useState } from "react";
import type { Diagnosis, TopicInput, TreeNode } from "../types";
import { kenChat, kenSummarize, type ChatMessage } from "../lib/ken";
import { mineText } from "../lib/tokenizer";

interface Props {
  diagnosis: Diagnosis;
  treeNodes: TreeNode[];
  onTopics: (topics: TopicInput[]) => void;
}

export default function KenChatPanel({ diagnosis, treeNodes, onTopics }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usingMock, setUsingMock] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      setBusy(true);
      const reply = await kenChat(diagnosis, [], treeNodes);
      setUsingMock(reply.mock);
      setMessages([{ role: "assistant", content: reply.text }]);
      setSuggestions(reply.suggestions);
      setBusy(false);
    })();
  }, [diagnosis]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!busy) {
      inputRef.current?.focus();
    }
  }, [busy]);

  const send = async (overrideContent?: string) => {
    const content = (overrideContent ?? input).trim();
    if (!content || busy) return;
    setInput("");
    setSuggestions([]);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setBusy(true);
    const reply = await kenChat(diagnosis, nextMessages, treeNodes);
    setUsingMock(reply.mock);
    setMessages([...nextMessages, { role: "assistant", content: reply.text }]);
    setSuggestions(reply.suggestions);
    setBusy(false);
  };

  const summarize = async () => {
    if (busy || messages.filter((message) => message.role === "user").length === 0) return;
    setBusy(true);
    const result = await kenSummarize(diagnosis, messages, treeNodes);
    let topics = result.topics;
    if (topics.length === 1 && topics[0].label === "__MINE__") {
      const mined = await mineText(topics[0].tags[0]);
      topics = mined ? [mined] : [];
    }
    if (topics.length > 0) {
      onTopics(topics);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `会話をまとめてツリーに追加したよ!🌳 ${topics
            .map((topic) => `「${topic.label}」`)
            .join("")}が生えたか見てみてね✨`,
        },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "うーん、まだトピックにできる話が少ないかも…もう少し聞かせて!🙏" },
      ]);
    }
    setBusy(false);
  };

  return (
    <div className="chat-area">
      <div className="chat-log" ref={logRef}>
        {messages.map((message, index) => (
          <div key={index} className={`chat-bubble ${message.role === "assistant" ? "ken" : "user"}`}>
            {message.role === "assistant" && <span className="speaker">Ken 🧑</span>}
            {message.content}
          </div>
        ))}
        {busy && (
          <div className="chat-bubble ken">
            <span className="speaker">Ken 🧑</span>考え中…💭
          </div>
        )}
      </div>
      {suggestions.length > 0 && !busy && (
        <div className="chat-suggestions">
          {suggestions.map((s, i) => (
            <button key={i} className="suggestion-button" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="chat-input-row">
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) send();
          }}
          placeholder="Kenに話してみよう"
          disabled={busy}
        />
        <button className="primary-button" onClick={() => send()} disabled={busy || !input.trim()}>
          送る
        </button>
      </div>
      <div className="chat-actions">
        <button
          className="ghost-button"
          onClick={summarize}
          disabled={busy || messages.filter((message) => message.role === "user").length === 0}
        >
          ツリーを伸ばす 🌳
        </button>
      </div>
      {usingMock && (
        <div className="status-note">
          ※ いまはデモモードだよ(OPENROUTER_API_KEYを設定すると本物のKenと話せます)
        </div>
      )}
    </div>
  );
}
