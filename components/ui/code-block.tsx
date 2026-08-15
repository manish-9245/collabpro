"use client"

import React, { useMemo } from 'react'
import Prism from 'prismjs'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'

export type CodeLanguage = 'json' | 'bash' | 'javascript' | 'typescript' | 'python' | 'go' | 'text'

interface CodeBlockProps {
    code: string
    language: CodeLanguage
    className?: string
}

// Any code snippet in the app should render through this component instead
// of a raw <pre><code> - keeps highlighting consistent everywhere and avoids
// re-solving "which Prism languages are loaded" per call site.
export default function CodeBlock({ code, language, className = '' }: CodeBlockProps) {
    const html = useMemo(() => {
        const grammar = Prism.languages[language];
        if (language === 'text' || !grammar) return null;
        return Prism.highlight(code, grammar, language);
    }, [code, language]);

    return (
        <pre className={`code-block-prism font-mono overflow-x-auto ${className}`}>
            {html ? (
                <code dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
                <code>{code}</code>
            )}
        </pre>
    );
}
