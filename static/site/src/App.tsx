import { useEffect, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SignalInNoiseHero } from './components/SignalInNoiseHero';
import privacyMarkdown from './content/privacy.md?raw';
import termsMarkdown from './content/tnc.md?raw';
import dpaMarkdown from './content/dpa.md?raw';

const DEFAULT_APP_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://app.localhost'
    : 'https://app.lexbot.pro';

const APP_URL = import.meta.env.VITE_APP_URL ?? DEFAULT_APP_URL;
const SIGNUP_URL = `${APP_URL}/signup?highlight=email`;

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function AppHeader() {
  return (
    <header className="site-header">
      <div className="site-shell site-header__inner">
        <a className="brand" href="/">
          Lexbot <span>Pro</span>
        </a>
        <nav className="site-nav" aria-label="Primary">
          <a href="/#workflow">Workflow</a>
          <a href="/#platform">Platform</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
        <div className="site-header__actions">
          <a className="button button--ghost" href={APP_URL}>
            Open app
          </a>
          <a className="button button--primary" href={SIGNUP_URL}>
            Start free
          </a>
        </div>
      </div>
    </header>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="section-heading">
      <div className="eyebrow-pill">{eyebrow}</div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="info-card">
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  );
}

function HomePage() {
  return (
    <>
      <SignalInNoiseHero
        eyebrow="Production-ready RAG"
        title="Find the signal across your documents"
        description="Lexbot Pro gives teams a fast path from noisy source material to grounded answers, with upload, retrieval, OCR, transcription, and chat in one place."
        primaryCtaLabel="Start free"
        secondaryCtaLabel="See the workflow"
        metrics={[
          { value: 'Minutes', label: 'from upload to searchable' },
          { value: 'Hybrid', label: 'retrieval + reasoning' },
          { value: '1 app', label: 'files, chat, and ops' },
        ]}
        onPrimaryClick={() => window.location.assign(SIGNUP_URL)}
        onSecondaryClick={() => document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      />

      <main>
        <section id="workflow" className="page-section page-section--dense">
          <div className="site-shell">
            <SectionHeading
              eyebrow="Signal in, answers out"
              title="A cleaner story for the product"
              description="The marketing site now frames the product around one motion: collect noisy inputs, structure them, and return usable signal to the team."
            />
            <div className="info-grid info-grid--three">
              <InfoCard title="1. Capture context">
                Upload documents, audio, or images and centralize the material your team actually uses.
              </InfoCard>
              <InfoCard title="2. Structure the noise">
                Use OCR, transcription, chunking, and hybrid search to turn raw files into something the model can work with.
              </InfoCard>
              <InfoCard title="3. Deliver signal">
                Answer questions with grounded citations, faster iteration loops, and a cleaner handoff from ops to product.
              </InfoCard>
            </div>
          </div>
        </section>

        <section id="platform" className="page-section">
          <div className="site-shell two-column-layout">
            <div>
              <SectionHeading
                eyebrow="Platform"
                title="Built for teams that need more than a toy demo"
                description="The page messaging is shaped for a real product stack: authentication, usage limits, telemetry, document processing, and an app that lives on its own subdomain."
              />
              <div className="stack-list">
                <div>
                  <strong>FastAPI backend</strong>
                  <span>API, ingestion, OCR, transcription, embeddings, and telemetry-ready services.</span>
                </div>
                <div>
                  <strong>React app on app.lexbot.pro</strong>
                  <span>Protected product surface kept separate from the public-facing landing experience.</span>
                </div>
                <div>
                  <strong>Static marketing on lexbot.pro</strong>
                  <span>Fast to load, SEO-friendly, and isolated from app routing and auth flows.</span>
                </div>
              </div>
            </div>
            <aside className="platform-panel">
              <div className="platform-panel__label">Deployment split</div>
              <div className="platform-panel__row">
                <span>lexbot.pro</span>
                <strong>Marketing site</strong>
              </div>
              <div className="platform-panel__row">
                <span>app.lexbot.pro</span>
                <strong>Product app</strong>
              </div>
              <div className="platform-panel__row">
                <span>staging.lexbot.pro</span>
                <strong>Staging app</strong>
              </div>
              <div className="platform-panel__note">
                CI now builds and deploys these surfaces independently so the marketing site can evolve without tangling with app routing.
              </div>
            </aside>
          </div>
        </section>

        <section className="page-section page-section--dense">
          <div className="site-shell cta-panel">
            <div>
              <div className="eyebrow-pill">Ready to try it</div>
              <h2>Keep the homepage public. Keep the product focused.</h2>
              <p>
                The infrastructure split makes the app easier to reason about while giving the brand a proper front door.
              </p>
            </div>
            <div className="cta-panel__actions">
              <a className="button button--primary" href={SIGNUP_URL}>
                Create free account
              </a>
              <a className="button button--ghost" href={APP_URL}>
                Open the app
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-shell site-footer__inner">
          <div>
            <div className="brand brand--footer">
              Lexbot <span>Pro</span>
            </div>
            <p>Structured answers for noisy data.</p>
          </div>
          <div className="site-footer__links">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/dpa">DPA</a>
            <a href={APP_URL}>App</a>
          </div>
        </div>
      </footer>
    </>
  );
}

function LegalPage({ title, markdown }: { title: string; markdown: string }) {
  return (
    <main className="legal-page">
      <div className="site-shell legal-page__shell">
        <a className="back-link" href="/">
          ← Back to home
        </a>
        <div className="eyebrow-pill">Legal</div>
        <h1>{title}</h1>
        <div className="legal-card">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      </div>
    </main>
  );
}

export default function App() {
  const pathname = normalizePathname(window.location.pathname);

  useEffect(() => {
    const title =
      pathname === '/privacy'
        ? 'Lexbot Pro | Privacy Policy'
        : pathname === '/terms'
          ? 'Lexbot Pro | Terms & Conditions'
          : pathname === '/dpa'
            ? 'Lexbot Pro | Data Processing Addendum'
            : 'Lexbot Pro | Structured answers for noisy data';
    document.title = title;
  }, [pathname]);

  let page: ReactNode;
  if (pathname === '/privacy') {
    page = <LegalPage title="Privacy Policy" markdown={privacyMarkdown} />;
  } else if (pathname === '/terms') {
    page = <LegalPage title="Terms & Conditions" markdown={termsMarkdown} />;
  } else if (pathname === '/dpa') {
    page = <LegalPage title="Data Processing Addendum" markdown={dpaMarkdown} />;
  } else {
    page = <HomePage />;
  }

  return (
    <div className="site-root">
      <AppHeader />
      {page}
    </div>
  );
}
