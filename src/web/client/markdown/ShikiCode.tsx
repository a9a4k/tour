import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

interface ShikiCodeProps {
  code: string;
  lang: string;
}

export function ShikiCode({ code, lang }: ShikiCodeProps): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    (async () => {
      try {
        const out = await codeToHtml(code, { lang, theme: "github-dark-default" });
        if (!cancelled) setHtml(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (failed || html === null) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  }
  return <div className="shiki-block" dangerouslySetInnerHTML={{ __html: html }} />;
}
