import { useState } from "react";
import diagnosesData from "./data/diagnoses.json";
import type { Diagnosis } from "./types";
import SelectScreen from "./components/SelectScreen";
import TreeScreen from "./components/TreeScreen";

const diagnoses = diagnosesData as Diagnosis[];

export default function App() {
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);

  return (
    <>
      <header className="app-header">
        <div className="app-logo">
          MemoryTree<span>.</span>
        </div>
        <div className="app-tagline">#就活特化型AI #ニョキニョキ育つ自己分析</div>
      </header>
      {diagnosis ? (
        <TreeScreen diagnosis={diagnosis} />
      ) : (
        <SelectScreen diagnoses={diagnoses} onStart={setDiagnosis} />
      )}
    </>
  );
}
