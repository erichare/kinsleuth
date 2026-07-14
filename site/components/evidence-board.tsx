export function EvidenceBoard() {
  return (
    <div className="evidence-board" aria-label="Fictional Hartwell–Mercer research question connected to a signature comparison, an independent family letter, and a working conclusion">
      <div className="board-toolbar">
        <span className="board-breadcrumb">Fictional Case 07 / Hartwell–Mercer</span>
        <span className="board-state"><i aria-hidden="true" /> In review</span>
      </div>
      <div className="question-card">
        <span className="card-label">Focused question</span>
        <strong>Were Samuel Mercer and Samuel March the same person?</strong>
        <p>Compare the signatures, then test them against an independent source. Matching age and route alone are not enough.</p>
      </div>
      <div className="evidence-row">
        <article className="record-card record-conflict">
          <span className="record-type">1907 passenger list</span>
          <strong>Samuel March</strong>
          <small>Northstar Cove → Lantern Bay · age 21</small>
        </article>
        <span className="versus" aria-hidden="true">?</span>
        <article className="record-card">
          <span className="record-type">1909 marriage record</span>
          <strong>Samuel Mercer</strong>
          <small>Lantern Bay, WI · signed record</small>
        </article>
      </div>
      <div className="signal-card">
        <span className="signal-icon" aria-hidden="true">R2</span>
        <div>
          <span className="card-label">Independent identifier</span>
          <strong>Maeve’s 1906 letter mentions both surnames without explaining why.</strong>
        </div>
        <span className="signal-score">Letter</span>
      </div>
      <div className="conclusion-card">
        <div>
          <span className="card-label">Question still open</span>
          <strong>One person, or two? Weigh the identifiers before deciding.</strong>
        </div>
        <span className="confidence">Needs review</span>
      </div>
      <div className="board-note">Fictional demo: every name, date, place, record, photo, and DNA value here is invented.</div>
    </div>
  );
}
