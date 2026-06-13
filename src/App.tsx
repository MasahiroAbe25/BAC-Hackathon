import { useState } from "react";
import diagnosesData from "./data/diagnoses.json";
import type { Diagnosis } from "./types";
import SelectScreen from "./components/SelectScreen";
import TreeScreen from "./components/TreeScreen";
import { saveDiagnosisId, loadDiagnosisId, clearDiagnosisId } from "./lib/storage";

const diagnoses = diagnosesData as Diagnosis[];

export default function App() {
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(() => {
    const id = loadDiagnosisId();
    return id ? (diagnoses.find((d) => d.id === id) ?? null) : null;
  });

  const handleStart = (d: Diagnosis) => {
    saveDiagnosisId(d.id);
    setDiagnosis(d);
  };

  const handleBack = () => {
    clearDiagnosisId();
    setDiagnosis(null);
  };

  return (
    <>
      <header className="app-header">
        <div className="app-logo">
          MemoryTree<span>.</span>
        </div>
        <div className="app-tagline">#就活特化型AI #ニョキニョキ育つ自己分析</div>
        {diagnosis && (
          <button className="back-button" onClick={handleBack}>
            ← 性格タイプを選び直す
          </button>
        )}
      </header>
      {diagnosis ? (
        <TreeScreen diagnosis={diagnosis} />
      ) : (
        <SelectScreen diagnoses={diagnoses} onStart={handleStart} />
      )}
    </>
  );
}
