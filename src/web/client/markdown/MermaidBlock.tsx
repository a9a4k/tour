import { useEffect, useId, useState } from "react";

interface MermaidBlockProps {
  source: string;
}

interface MermaidLike {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
}

let mermaidPromise: Promise<MermaidLike> | null = null;
let mermaidInitialized = false;

async function loadMermaid(): Promise<MermaidLike> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default as unknown as MermaidLike);
  }
  const mermaid = await mermaidPromise;
  if (!mermaidInitialized) {
    mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
    mermaidInitialized = true;
  }
  return mermaid;
}

export function MermaidBlock({ source }: MermaidBlockProps): React.JSX.Element {
  const reactId = useId();
  const renderId = `mermaid-${reactId.replace(/:/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    (async () => {
      try {
        const mermaid = await loadMermaid();
        const out = await mermaid.render(renderId, source);
        if (!cancelled) setSvg(out.svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, renderId]);

  if (failed) {
    return (
      <div className="mermaid-block mermaid-failed">
        <div className="mermaid-error-header">⚠ mermaid render failed</div>
        <pre>
          <code>{source}</code>
        </pre>
      </div>
    );
  }
  if (svg === null) {
    return <div className="mermaid-block mermaid-loading">rendering diagram…</div>;
  }
  return <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />;
}
