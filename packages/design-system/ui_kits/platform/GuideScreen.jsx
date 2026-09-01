const {
  Tabs,
  Card,
  CoverageBar,
  TrustTag,
  NotificationBanner,
  Button,
  Details,
  Icon,
  SummaryList,
} = window.BADS;

function GuideScreen() {
  const G = window.BAData.guide;
  const [layer, setLayer] = React.useState("brief");
  return (
    <React.Fragment>
      <TopBar
        title={G.subject}
        meta="Product guide · seeded from the bid-library template · Viewer view"
        actions={
          <Button
            size="sm"
            variant="secondary"
            iconLeft={<Icon name="download-simple" size={14} />}
          >
            Export
          </Button>
        }
      />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div
          style={{
            maxWidth: "900px",
            margin: "0 auto",
            padding: "20px 24px 40px",
            display: "flex",
            gap: "28px",
          }}
        >
          <div
            style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "18px" }}
          >
            <Tabs
              value={layer}
              onChange={setLayer}
              tabs={[
                { value: "brief", label: "Brief" },
                { value: "detail", label: "Detail" },
              ]}
            />
            {G.sections.map((s) => (
              <section
                key={s.name}
                style={{ display: "flex", flexDirection: "column", gap: "9px" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: "var(--text-xl)",
                      fontWeight: "var(--weight-semibold)",
                      letterSpacing: "var(--tracking-heading)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {s.name}
                  </h2>
                  <TrustTag size="sm" state={s.trust} by={s.by} at={s.at} />
                </div>
                {s.review && (
                  <NotificationBanner
                    tone="warning"
                    heading="Needs review"
                    action={<Button size="sm">Open the change</Button>}
                  >
                    {s.review}
                  </NotificationBanner>
                )}
                {layer === "brief" ? (
                  <p
                    style={{
                      margin: 0,
                      maxWidth: "var(--measure-prose)",
                      fontSize: "var(--text-lg)",
                      lineHeight: "var(--leading-prose)",
                      color: "var(--text-body)",
                    }}
                  >
                    {s.brief}
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <p
                      style={{
                        margin: 0,
                        padding: "10px 12px",
                        background: "var(--surface-sunken)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-sm)",
                        fontSize: "var(--text-base)",
                        lineHeight: "var(--leading-normal)",
                        color: "var(--text-body)",
                      }}
                    >
                      “{s.brief}”
                    </p>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                      The included concepts' own words, in order.
                    </span>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <CoverageBar
                    style={{ maxWidth: "260px", flex: 1 }}
                    included={s.coverage[0]}
                    expected={s.coverage[1]}
                    label="Coverage"
                  />
                  <Details summary="Which concepts this section includes">
                    ISO 27001 certification · Certified operating centres · BS 7858 vetting · …
                  </Details>
                </div>
              </section>
            ))}
          </div>
          <aside style={{ width: "240px", flexShrink: 0 }}>
            <Card title="This guide" padding="md" footer={"Map as of " + window.BAData.mapAsOf}>
              <SummaryList
                dense
                items={[
                  { term: "Kind", description: "Product" },
                  { term: "Roles", description: "Viewer, Editor, Admin" },
                  { term: "Sections", description: "3 of 3 shown" },
                  { term: "Owner", description: "Liam Doyle" },
                ]}
              />
            </Card>
          </aside>
        </div>
      </div>
    </React.Fragment>
  );
}
Object.assign(window, { GuideScreen });
