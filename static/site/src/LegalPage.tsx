import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import privacyMarkdown from './content/privacy.md?raw';
import termsMarkdown from './content/tnc.md?raw';
import dpaMarkdown from './content/dpa.md?raw';

const legalPageContent = {
  '/privacy': {
    title: 'Privacy Policy',
    markdown: privacyMarkdown,
  },
  '/terms': {
    title: 'Terms & Conditions',
    markdown: termsMarkdown,
  },
  '/dpa': {
    title: 'Data Processing Addendum',
    markdown: dpaMarkdown,
  },
} as const;

type LegalPath = keyof typeof legalPageContent;

export default function LegalPage({ pathname }: { pathname: LegalPath }) {
  const page = legalPageContent[pathname];

  return (
    <main className="legal-page">
      <div className="site-shell legal-page__shell">
        <a className="back-link" href="/">
          ← Back to home
        </a>
        <div className="eyebrow-pill">Legal</div>
        <h1>{page.title}</h1>
        <div className="legal-card">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.markdown}</ReactMarkdown>
        </div>
      </div>
    </main>
  );
}
