type LawyersPageProps = {
  appUrl: string;
  signupUrl: string;
};

const legalWorkflowCards = [
  {
    title: 'Contract review',
    description: 'Get a first-pass review that highlights key terms, risk areas, missing protections, and practical next steps.',
  },
  {
    title: 'NDA review',
    description: 'Check confidentiality scope, term, residuals, remedies, exclusions, return obligations, and approval blockers.',
  },
  {
    title: 'Risk matrix',
    description: 'Turn a dense agreement into a structured risk table that is easier to review with clients or business teams.',
  },
  {
    title: 'Clause extraction',
    description: 'Pull important provisions into a clean, reviewable format with source-backed context.',
  },
  {
    title: 'Obligation tracker',
    description: 'Identify deadlines, notices, reporting duties, payment terms, and post-signature follow-ups.',
  },
  {
    title: 'Negotiation brief',
    description: 'Prepare a practical list of must-haves, acceptable fallbacks, and issues that need escalation.',
  },
];

const valueCards = [
  {
    title: 'Move faster on the first pass',
    description: 'Reduce manual scanning by starting with a structured review instead of a blank page.',
  },
  {
    title: 'Keep the source material visible',
    description: 'Work from uploaded contracts and supporting files so outputs stay connected to the documents being reviewed.',
  },
  {
    title: 'Standardize repeatable work',
    description: 'Use guided workflows for the common legal jobs that come up again and again.',
  },
];

const useCases = [
  'Review NDAs before they reach a partner or senior lawyer.',
  'Summarize agreement risk for founders, sales teams, or finance.',
  'Extract obligations and dates from signed contracts.',
  'Prepare handoff notes for another reviewer or client-facing update.',
  'Compare versions and focus attention on what changed.',
];

export default function LawyersPage({ appUrl, signupUrl }: LawyersPageProps) {
  return (
    <>
      <main className="lawyers-page">
      <section className="lawyers-hero">
        <div className="site-shell lawyers-hero__grid">
          <div className="lawyers-hero__copy">
            <div className="eyebrow-pill">For lawyers and legal teams</div>
            <h1>AI workflows for contract-heavy legal work</h1>
            <p>
              Lexbot Pro helps lawyers turn contracts, client files, and supporting documents into structured reviews,
              sourced summaries, risk matrices, and handoff-ready outputs.
            </p>
            <div className="lawyers-hero__actions">
              <a className="button button--primary" href={signupUrl}>
                Start free
              </a>
              <a className="button button--ghost" href="#legal-workflows">
                View workflows
              </a>
            </div>
          </div>

          <aside className="lawyers-hero__panel" aria-label="Legal workflow preview">
            <div className="lawyers-panel__header">
              <span>Contract review</span>
              <strong>First-pass output</strong>
            </div>
            <div className="lawyers-panel__section">
              <span className="lawyers-panel__label">Risk areas</span>
              <ul>
                <li>Unlimited liability exposure</li>
                <li>Broad confidentiality obligations</li>
                <li>Missing cure period before termination</li>
              </ul>
            </div>
            <div className="lawyers-panel__section">
              <span className="lawyers-panel__label">Next actions</span>
              <div className="lawyers-panel__chips">
                <span>Draft fallback</span>
                <span>Create risk matrix</span>
                <span>Prepare brief</span>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="lawyers-strip" aria-label="Legal product highlights">
        <div className="site-shell lawyers-strip__grid">
          <div>
            <strong>Contract review</strong>
            <span>Surface issues faster</span>
          </div>
          <div>
            <strong>Sourced outputs</strong>
            <span>Stay grounded in the files</span>
          </div>
          <div>
            <strong>Workflow cards</strong>
            <span>Standardize repeatable work</span>
          </div>
        </div>
      </section>

      <section className="page-section page-section--dense">
        <div className="site-shell">
          <div className="section-heading">
            <div className="eyebrow-pill">Why it helps</div>
            <h2>Designed for the work between intake and final advice</h2>
            <p>
              Use Lexbot Pro to accelerate document review, organize contract findings, and create cleaner work product before a lawyer makes the final call.
            </p>
          </div>

          <div className="info-grid info-grid--three">
            {valueCards.map((card) => (
              <article key={card.title} className="info-card lawyers-value-card">
                <h3>{card.title}</h3>
                <p>{card.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="legal-workflows" className="page-section page-section--dense lawyers-section--muted">
        <div className="site-shell">
          <div className="section-heading">
            <div className="eyebrow-pill">Legal workflows</div>
            <h2>Start with a workflow, not a blank prompt</h2>
            <p>
              Pick the legal task you want to run, select the relevant files, and get a structured output you can review, refine, and export.
            </p>
          </div>

          <div className="lawyers-workflow-grid">
            {legalWorkflowCards.map((card) => (
              <article key={card.title} className="lawyers-workflow-card">
                <div className="workflow-card__badge">Workflow</div>
                <h3>{card.title}</h3>
                <p>{card.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="page-section page-section--dense">
        <div className="site-shell two-column-layout">
          <div>
            <div className="section-heading">
              <div className="eyebrow-pill">Use cases</div>
              <h2>Useful across legal teams, small firms, and contract-heavy businesses</h2>
              <p>
                Support common legal workflows with source-backed outputs that are easier to review, refine, and share.
              </p>
            </div>
          </div>
          <aside className="platform-panel lawyers-use-case-panel">
            <div className="platform-panel__label">Common jobs</div>
            <ul className="lawyers-check-list">
              {useCases.map((useCase) => (
                <li key={useCase}>{useCase}</li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="page-section page-section--dense">
        <div className="site-shell cta-panel lawyers-cta-panel">
          <div>
            <div className="eyebrow-pill">Try it with a real document</div>
            <h2>Upload a contract and run the first workflow</h2>
            <p>
              The fastest way to evaluate the product is to run it on a real NDA, services agreement, or client document and inspect the output quality yourself.
            </p>
          </div>
          <div className="cta-panel__actions">
            <a className="button button--primary" href={signupUrl}>
              Create free account
            </a>
            <a className="button button--ghost" href={appUrl}>
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
            <p>AI workflows for contract-heavy legal work.</p>
          </div>
          <div className="site-footer__links">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/dpa">DPA</a>
            <a href={appUrl}>App</a>
          </div>
        </div>
      </footer>
    </>
  );
}
