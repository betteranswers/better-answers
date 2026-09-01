const {
  Button,
  Input,
  Icon,
  Citation,
  TrustTag,
  Details,
  NotificationBanner,
  Tag,
  IconButton,
  Tooltip,
  EmptyState,
} = window.BADS;

function AskScreen() {
  const D = window.BAData.answer;
  const [asked, setAsked] = React.useState(true);
  const [q, setQ] = React.useState("What is our ISO 27001 scope?");
  const [flagged, setFlagged] = React.useState(null);
  return (
    <React.Fragment>
      <TopBar
        title="Ask"
        meta={"Answers cite the bundle · map as of " + window.BAData.mapAsOf}
        actions={
          <Button
            size="sm"
            variant="ghost"
            iconLeft={<Icon name="clock-counter-clockwise" size={14} />}
          >
            History
          </Button>
        }
      />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div
          style={{
            maxWidth: "780px",
            margin: "0 auto",
            padding: "28px 24px 40px",
            display: "flex",
            flexDirection: "column",
            gap: "22px",
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAsked(true);
            }}
            style={{ display: "flex", gap: "8px" }}
          >
            <Input
              style={{ flex: 1 }}
              size="lg"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              prefix={<Icon name="magnifying-glass" size={15} />}
              placeholder="Ask a question of the map"
            />
            <Button size="lg" variant="primary" type="submit">
              Ask
            </Button>
          </form>

          {!asked && (
            <EmptyState
              icon={<Icon name="chat-text" size={20} />}
              title="Ask a question of the company's knowledge."
              description="Every answer names the concepts it rests on and what it could not answer."
            />
          )}

          {asked && (
            <React.Fragment>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Tag tone="success" icon={<Icon name="check-circle" size={12} />}>
                  {D.verdict}
                </Tag>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  Viewer · 3 concepts reached · 1.2s
                </span>
              </div>

              <div
                style={{
                  maxWidth: "var(--measure-prose)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                {D.prose.map((p) => (
                  <p
                    key={p.marker}
                    style={{
                      margin: 0,
                      fontSize: "var(--text-lg)",
                      lineHeight: "var(--leading-prose)",
                      color: "var(--text-body)",
                    }}
                  >
                    {p.text}
                    <sup
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "10px",
                        color: "var(--text-link)",
                        marginLeft: "2px",
                        verticalAlign: "super",
                      }}
                    >
                      {p.marker}
                    </sup>
                  </p>
                ))}
              </div>

              <NotificationBanner tone="info" heading="What this answer could not tell you">
                {D.unanswered}
              </NotificationBanner>

              <section style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: "var(--text-xs)",
                    fontWeight: "var(--weight-medium)",
                    letterSpacing: "var(--tracking-caps)",
                    textTransform: "uppercase",
                    color: "var(--text-faint)",
                  }}
                >
                  Citations
                </h2>
                {D.citations.map((c) => (
                  <Citation
                    key={c.marker}
                    marker={c.marker}
                    concept={c.concept}
                    source={c.source}
                    locator={c.locator}
                    passage={c.passage}
                    trust={<TrustTag size="sm" state={c.state} by={c.by} at={c.at} />}
                  />
                ))}
              </section>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  paddingTop: "6px",
                  borderTop: "1px solid var(--border-subtle)",
                }}
              >
                <span
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-muted)",
                    marginRight: "2px",
                  }}
                >
                  Was this helpful?
                </span>
                <Button
                  size="sm"
                  variant={flagged === "helpful" ? "primary" : "secondary"}
                  onClick={() => setFlagged("helpful")}
                >
                  Helpful
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setFlagged("flag")}>
                  Flag
                </Button>
                <div style={{ flex: 1 }} />
                <Tooltip label="Copy with citations  ⌘C">
                  <IconButton label="Copy with citations" variant="outline">
                    <Icon name="copy" />
                  </IconButton>
                </Tooltip>
                <Button size="sm" variant="accent">
                  Save as an Answer
                </Button>
              </div>

              {flagged === "flag" && (
                <NotificationBanner tone="warning" heading="Flagged">
                  Choose a reason — wrong · out of date · incomplete · should not have shown. It
                  becomes a record in someone's queue.
                </NotificationBanner>
              )}

              <Details summary="Show the answer audit entry">
                Asked by you on the app surface · predicate: published · Internal · Bid team · cited
                3 concepts, trust at the time: 1 checked, 1 machine-confirmed, 1 out of date.
              </Details>
            </React.Fragment>
          )}
        </div>
      </div>
    </React.Fragment>
  );
}
Object.assign(window, { AskScreen });
