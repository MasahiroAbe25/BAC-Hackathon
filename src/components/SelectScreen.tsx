import { useState } from "react";
import type { Diagnosis } from "../types";

interface Props {
  diagnoses: Diagnosis[];
  onStart: (diagnosis: Diagnosis) => void;
}

export default function SelectScreen({ diagnoses, onStart }: Props) {
  const [selected, setSelected] = useState<Diagnosis | null>(null);

  return (
    <div className="select-screen">
      <h1>きみの就活占い、どれだった?</h1>
      <div className="hashtags">#就活占い #自分のタイプを選んでみよう</div>
      <div className="diagnosis-grid">
        {diagnoses.map((diagnosis) => (
          <button
            key={diagnosis.id}
            className={`diagnosis-card${selected?.id === diagnosis.id ? " selected" : ""}`}
            onClick={() => setSelected(diagnosis)}
          >
            {diagnosis.title}
          </button>
        ))}
      </div>
      {selected && (
        <div className="summary-panel">
          <h2>あなたの診断結果</h2>
          <div className="summary-title">{selected.title}</div>
          <p>{selected.summary}</p>
          <button className="primary-button" onClick={() => onStart(selected)}>
            この結果でツリーを育てる 🌱
          </button>
        </div>
      )}
    </div>
  );
}
