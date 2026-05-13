import { SignalInNoiseHero } from './components/SignalInNoiseHero';

type LawyersPageProps = {
  appUrl: string;
  signupUrl: string;
};

const legalWorkflowCards = [
  {
    title: 'Contract review',
    description: 'Review key terms, risk areas, missing protections, and practical next steps from the selected agreement.',
  },
  {
    title: 'NDA review',
    description: 'Check confidentiality scope, term, residuals, remedies, exclusions, return duties, and approval blockers.',
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

const searchExamples = [
  'Find a clause, definition, obligation, party, date, notice requirement, or governing law provision.',
  'Ask across uploaded contracts, exhibits, prior reviews, and supporting client files.',
  'Move from an answer into the right workflow when the issue needs a structured output.',
];

const valueCards = [
  {
    title: 'Search first when you need context',
    description: 'Ask across uploaded documents to find the source material, compare terms, and understand where an issue appears.',
  },
  {
    title: 'Use workflows when you need output',
    description: 'Turn selected files into reviews, matrices, trackers, briefs, and handoffs without starting from a blank prompt.',
  },
  {
    title: 'Keep both grounded in the files',
    description: 'Search answers and workflow outputs stay connected to the documents being reviewed so the source material remains visible.',
  },
];

const useCases = [
  'Search a batch of NDAs for residuals, non-standard terms, or confidentiality periods, then run an NDA review on the files that need attention.',
  'Find liability, indemnity, payment, termination, or renewal language across uploaded contracts, then turn the findings into a risk matrix.',
  'Ask questions across client files before a call, then generate a handoff or summary that can be reviewed and shared.',
  'Locate obligations, notice windows, and deadlines in signed agreements, then move them into an obligation tracker.',
  'Compare versions and search supporting documents before preparing a negotiation brief.',
];

export default function LawyersPage({ appUrl, signupUrl }: LawyersPageProps) {
  return (
    <>
      <SignalInNoiseHero
        className="signal-hero--lawyers"
        eyebrow="For lawyers and legal teams"
        title="Search your legal files. Run the workflows that follow."
        description="Lexbot Pro gives legal teams two connected ways to work: search across uploaded documents when you need answers, and launch legal workflows when you need structured work product."
        primaryCtaLabel="Start free"
        secondaryCtaLabel="See the product"
        metrics={[
          { value: 'Search', label: 'across uploaded documents' },
          { value: 'Workflows', label: 'for repeatable legal tasks' },
          { value: 'Sources', label: 'visible in the output' },
        ]}
        onPrimaryClick={() => window.location.assign(signupUrl)}
        onSecondaryClick={() => document.getElementById('legal-product')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      />

      <main className="lawyers-page">
        <section className="lawyers-strip" aria-label="Legal product highlights">
          <div className="site-shell lawyers-strip__grid">
            <div>
              <strong>Document search</strong>
              <span>Find answers across uploaded legal files</span>
            </div>
            <div>
              <strong>Legal workflows</strong>
              <span>Turn documents into structured outputs</span>
            </div>
            <div>
              <strong>Sourced results</strong>
              <span>Keep the underlying material visible</span>
            </div>
          </div>
        </section>

        <section id="legal-product" className="page-section page-section--dense">
          <div className="site-shell">
            <div className="section-heading">
              <div className="eyebrow-pill">Product view</div>
              <h2>Half search engine, half legal workflow system</h2>
              <p>
                Use search when you need to understand the document set. Use workflows when you need to convert that understanding into a reviewable legal output.
              </p>
            </div>

            <div className="lawyers-product-split">
              <article className="lawyers-product-card lawyers-product-card--featured">
                <div className="workflow-card__badge">Document search</div>
                <h3>Ask across the uploaded matter file</h3>
                <p>
                  Search contracts, exhibits, policies, prior reviews, and supporting files from one place. Find the clause, term, date, obligation, or issue before deciding what work needs to happen next.
                </p>
                <ul className="lawyers-check-list lawyers-check-list--compact">
                  <li>Find provisions and definitions across multiple documents.</li>
                  <li>Ask follow-up questions without losing the source context.</li>
                  <li>Use the answer as the starting point for a workflow.</li>
                </ul>
              </article>

              <article className="lawyers-product-card lawyers-product-card--featured">
                <div className="workflow-card__badge">Legal workflows</div>
                <h3>Turn documents into structured work product</h3>
                <p>
                  Run repeatable legal tasks from selected files. Start with the source material, choose the output you need, and review a structured result built for the next legal step.
                </p>
                <ul className="lawyers-check-list lawyers-check-list--compact">
                  <li>Run reviews, matrices, trackers, briefs, and handoffs.</li>
                  <li>Standardize common first-pass work across the team.</li>
                  <li>Move faster from intake to reviewable output.</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="page-section page-section--dense lawyers-section--muted">
          <div className="site-shell">
            <div className="section-heading">
              <div className="eyebrow-pill">Why it helps</div>
              <h2>One workspace for finding the issue and producing the next artifact</h2>
              <p>
                Legal work often starts with a question and ends with an output. Lexbot Pro keeps both parts connected to the uploaded documents.
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

        <section className="page-section page-section--dense">
          <div className="site-shell two-column-layout lawyers-search-layout">
            <div>
              <div className="section-heading">
                <div className="eyebrow-pill">Document search</div>
                <h2>Search the material before you shape the output</h2>
                <p>
                  Start by asking questions across the uploaded documents. Use it to find the right clause, check whether a term appears elsewhere, or understand what the file set says before running a workflow.
                </p>
              </div>
            </div>
            <aside className="platform-panel lawyers-search-panel">
              <div className="platform-panel__label">Search examples</div>
              <ul className="lawyers-check-list">
                {searchExamples.map((example) => (
                  <li key={example}>{example}</li>
                ))}
              </ul>
            </aside>
          </div>
        </section>

        <section id="legal-workflows" className="page-section page-section--dense lawyers-section--muted">
          <div className="site-shell">
            <div className="section-heading">
              <div className="eyebrow-pill">Legal workflows</div>
              <h2>When the question becomes a task, run a workflow</h2>
              <p>
                Pick the legal job you want to complete, select the relevant files, and get a structured output you can review, refine, and export.
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
                <h2>Useful for research-heavy and contract-heavy legal work</h2>
                <p>
                  Search helps you find the issue. Workflows help you package the answer into the next thing the matter needs.
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
              <div className="eyebrow-pill">Try it with real files</div>
              <h2>Upload documents, search the set, then run a workflow</h2>
              <p>
                The fastest way to evaluate the product is to use a real NDA, services agreement, or matter file and see how search and workflows work together.
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
            <p>Document search and legal workflows for contract-heavy work.</p>
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
