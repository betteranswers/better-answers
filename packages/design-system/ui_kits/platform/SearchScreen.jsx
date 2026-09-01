const { Input, Icon, Tag, TrustTag, Button, Tabs } = window.BADS;

function SearchScreen() {
  const [tab, setTab] = React.useState("all");
  const hits = window.BAData.hits;
  return (
    <React.Fragment>
      <TopBar title="Search" meta="Concepts first; documents only where no concept covers them" />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div
          style={{
            maxWidth: "860px",
            margin: "0 auto",
            padding: "22px 24px 40px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <Input
            size="lg"
            defaultValue="ISO 27001"
            prefix={<Icon name="magnifying-glass" size={15} />}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Tag size="sm" onRemove={() => {}}>
              Domain: Company
            </Tag>
            <Tag size="sm" onRemove={() => {}}>
              Kind: Certification
            </Tag>
            <Button
              size="sm"
              variant="ghost"
              iconLeft={<Icon name="sliders-horizontal" size={13} />}
            >
              Add a filter
            </Button>
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "all", label: "All", count: 12 },
              { value: "concepts", label: "Concepts", count: 9 },
              { value: "documents", label: "Documents", count: 3 },
            ]}
          />
          <div style={{ display: "flex", flexDirection: "column" }}>
            {hits.map((h, i) => (
              <article
                key={i}
                style={{
                  padding: "14px 2px",
                  borderBottom: "1px solid var(--border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "5px",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}
                >
                  <span
                    style={{
                      fontSize: "var(--text-2xs)",
                      letterSpacing: "var(--tracking-caps)",
                      textTransform: "uppercase",
                      color: "var(--text-faint)",
                    }}
                  >
                    {h.layer}
                  </span>
                  <a
                    href="#"
                    style={{
                      fontSize: "var(--text-md)",
                      fontWeight: "var(--weight-medium)",
                      color: "var(--text-primary)",
                      textDecoration: "none",
                    }}
                  >
                    {h.title}
                  </a>
                  {h.kind && <Tag size="sm">{h.kind}</Tag>}
                  <TrustTag size="sm" state={h.state} by={h.by} at={h.at} />
                </div>
                {h.sub.map((s, j) => (
                  <p
                    key={j}
                    style={{
                      margin: 0,
                      paddingLeft: "12px",
                      borderLeft: "1px solid var(--border-subtle)",
                      fontSize: "var(--text-xs)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {s}
                  </p>
                ))}
              </article>
            ))}
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}
Object.assign(window, { SearchScreen });
