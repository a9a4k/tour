import { Children, isValidElement, type ReactElement } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "./MermaidBlock.js";
import { ShikiCode } from "./ShikiCode.js";

interface AnnotationMarkdownProps {
  body: string;
}

interface CodeChildProps {
  className?: string;
  children?: React.ReactNode;
}

export function AnnotationMarkdown({ body }: AnnotationMarkdownProps): React.JSX.Element {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre({ children, ...props }) {
          const child = Children.toArray(children)[0];
          if (isValidElement(child) && child.type === "code") {
            const { className, children: codeChildren } = (child as ReactElement<CodeChildProps>).props;
            const match = /language-([\w-]+)/.exec(className ?? "");
            const code = String(codeChildren ?? "").replace(/\n$/, "");
            if (match) {
              if (match[1] === "mermaid") {
                return <MermaidBlock source={code} />;
              }
              return <ShikiCode code={code} lang={match[1]} />;
            }
          }
          return <pre {...props}>{children}</pre>;
        },
        a({ href, children, ...rest }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
              {children}
            </a>
          );
        },
      }}
    >
      {body}
    </Markdown>
  );
}
