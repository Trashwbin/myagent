import React, { useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ShikiHighlighter = {
  codeToHtml(code: string, options: { lang: string; theme: string }): string;
};

type ShikiCoreModule = {
  createHighlighterCore(options: {
    themes: unknown[];
    langs: unknown[];
    engine: unknown;
  }): Promise<ShikiHighlighter>;
};

type ShikiEngineModule = {
  createJavaScriptRegexEngine(): unknown;
};

type ShikiModuleDefault = {
  default: unknown;
};

type CodeProps = {
  inline?: boolean;
  className?: string;
  children?: ReactNode;
};

type PreProps = {
  children?: ReactNode;
};

type MarkdownContentProps = {
  text: string;
};

const roots = new WeakMap<Element, Root>();
const highlightCache = new Map<string, Promise<string>>();
let highlighterPromise: Promise<ShikiHighlighter> | null = null;

function codeText(children: ReactNode): string {
  return React.Children.toArray(children).join("").replace(/\n$/, "");
}

function languageFromClass(className?: string): string {
  const match = /language-([\w-]+)/.exec(className || "");
  return match ? match[1] : "";
}

async function highlightCode(code: string, language: string): Promise<string> {
  if (!supportedLanguage(language)) return "";
  const key = language + "\0" + code;
  const hit = highlightCache.get(key);
  if (hit) return hit;

  const promise = getHighlighter()
    .then((highlighter) => {
      return highlighter.codeToHtml(code, {
        lang: language,
        theme: "github-light",
      });
    })
    .catch(() => "");

  highlightCache.set(key, promise);
  return promise;
}

function supportedLanguage(language: string): boolean {
  return [
    "bash",
    "css",
    "diff",
    "go",
    "html",
    "javascript",
    "json",
    "jsx",
    "markdown",
    "python",
    "rust",
    "shellscript",
    "tsx",
    "typescript",
    "yaml",
  ].includes(language);
}

function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import("shiki/core") as Promise<ShikiCoreModule>,
      import("shiki/engine/javascript") as Promise<ShikiEngineModule>,
      import("shiki/themes/github-light.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/bash.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/css.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/diff.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/go.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/html.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/javascript.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/json.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/jsx.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/markdown.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/python.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/rust.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/shellscript.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/tsx.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/typescript.mjs") as Promise<ShikiModuleDefault>,
      import("shiki/langs/yaml.mjs") as Promise<ShikiModuleDefault>,
    ]).then(([core, engine, theme, ...langs]) => {
      return core.createHighlighterCore({
        themes: [theme.default],
        langs: langs.map((lang) => lang.default),
        engine: engine.createJavaScriptRegexEngine(),
      });
    });
  }
  return highlighterPromise;
}

function Code({ inline, className, children, ...props }: CodeProps) {
  if (!inline) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return (
    <code className="md-inline-code" {...props}>
      {children}
    </code>
  );
}

function Pre({ children }: PreProps) {
  const codeEl = React.Children.toArray(children).find((child) => React.isValidElement(child));
  const className = React.isValidElement<CodeProps>(codeEl) ? codeEl.props.className : "";
  const codeChildren = React.isValidElement<CodeProps>(codeEl) ? codeEl.props.children : children;
  const code = codeText(codeChildren);
  const language = languageFromClass(className);
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!language) {
      setHtml("");
      return () => {
        cancelled = true;
      };
    }

    highlightCode(code, language).then((next) => {
      if (!cancelled) setHtml(next);
    });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (html) {
    return <div className="md-code" dangerouslySetInnerHTML={{ __html: html }} />;
  }

  return (
    <pre className="md-code md-code-fallback">
      <code className={className}>
        {codeChildren}
      </code>
    </pre>
  );
}

function MarkdownContent({ text }: MarkdownContentProps) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: Code,
          pre: Pre,
          a({ children, href, ...props }) {
            return (
              <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {text || ""}
      </ReactMarkdown>
    </div>
  );
}

export function AssistantMarkdown({ text }: { text: string }) {
  return <MarkdownContent text={text} />;
}

export function renderAssistantMarkdown(container: HTMLElement, text: string) {
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  container.dataset.markdownSource = text || "";
  root.render(<MarkdownContent text={text || ""} />);
}

export function unmountAssistantMarkdown(container: Element) {
  const root = roots.get(container);
  if (!root) return;
  root.unmount();
  roots.delete(container);
}
