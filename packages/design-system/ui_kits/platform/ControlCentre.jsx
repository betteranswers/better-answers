const {
  Card,
  Button,
  Tag,
  TrustTag,
  DataTable,
  Dialog,
  Toast,
  Details,
  Input,
  Icon,
  Tabs,
  SummaryList,
  NotificationBanner,
  EmptyState,
  Checkbox,
} = window.BADS;

function SuggestionsScreen() {
  const [items, setItems] = React.useState(window.BAData.suggestions);
  const [open, setOpen] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const [tab, setTab] = React.useState("waiting");
  const accept = () => {
    const t = open;
    setItems(items.filter((i) => i !== t));
    setOpen(null);
    setToast({ message: "Accepted. One governed write.", detail: "Commit 4f1c9ad · " + t.title });
    setTimeout(() => setToast(null), 4000);
  };
  return (
    <React.Fragment>
      <TopBar
        title="Suggestions"
        meta="Every waiting suggestion, one queue"
        actions={
          <Button size="sm" variant="ghost" iconLeft={<Icon name="funnel" size={14} />}>
            Filter
          </Button>
        }
      />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div
          style={{
            maxWidth: "880px",
            margin: "0 auto",
            padding: "20px 24px 40px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "waiting", label: "Waiting", count: items.length },
              { value: "decided", label: "Decided", count: 341 },
            ]}
          />
          {tab === "decided" ? (
            <EmptyState
              icon={<Icon name="check" size={20} />}
              title="341 decided suggestions."
              description="Filter by kind, decider or date to find one."
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Icon name="tray" size={20} />}
              title="Nothing is waiting."
              description="Suggestions arrive from runs, from the platform bundle and from people who may not commit."
            />
          ) : (
            items.map((s, i) => (
              <Card
                key={i}
                padding="md"
                title={s.title}
                meta={s.from + " · " + s.when}
                actions={
                  <React.Fragment>
                    <Button size="sm" variant="ghost">
                      Decline
                    </Button>
                    <Button size="sm" variant="accent" onClick={() => setOpen(s)}>
                      Review
                    </Button>
                  </React.Fragment>
                }
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <Tag size="sm" tone={s.kind === "promotion" ? "accent" : "neutral"}>
                      {s.kind}
                    </Tag>
                    {s.kind === "candidate" && <Tag size="sm">Accept gate</Tag>}
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "var(--text-base)",
                      color: "var(--text-secondary)",
                      lineHeight: "var(--leading-normal)",
                    }}
                  >
                    {s.detail}
                  </p>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
      <Dialog
        open={!!open}
        title={open ? open.title : ""}
        description="Accepting writes to the bundle as one commit, with you as the decider."
        consequence="One governed write. Audited under your name."
        actions={
          <React.Fragment>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={accept}>
              Accept
            </Button>
          </React.Fragment>
        }
        onClose={() => setOpen(null)}
      >
        <SummaryList
          dense
          items={[
            { term: "Prepared by", description: open ? open.from : "" },
            { term: "Domain", description: "Company" },
            { term: "Sensitivity", description: "Restricted" },
          ]}
        />
      </Dialog>
      {toast && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "20px",
            transform: "translateX(-50%)",
            zIndex: 70,
          }}
        >
          <Toast
            message={toast.message}
            detail={toast.detail}
            undoLabel="Undo"
            onUndo={() => setToast(null)}
          />
        </div>
      )}
    </React.Fragment>
  );
}

function KnowledgeScreen() {
  const [sel, setSel] = React.useState([]);
  const rows = window.BAData.concepts;
  return (
    <React.Fragment>
      <TopBar
        title="Knowledge"
        meta="The review table over every concept and composition"
        actions={
          <React.Fragment>
            <Button size="sm" variant="ghost">
              Exports
            </Button>
            <Button size="sm" variant="secondary" iconLeft={<Icon name="plus" size={14} />}>
              New concept
            </Button>
          </React.Fragment>
        }
      />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div
          style={{
            padding: "20px 24px 40px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Input
              size="sm"
              style={{ width: "260px" }}
              placeholder="Filter concepts"
              prefix={<Icon name="magnifying-glass" size={13} />}
            />
            <Tag size="sm" onRemove={() => {}}>
              Saved filter: Due a check
            </Tag>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              {sel.length ? sel.length + " selected" : "1,284 concepts · 96.4% with an owner"}
            </span>
            {sel.length > 0 && (
              <React.Fragment>
                <Button size="sm" variant="secondary">
                  Request a check
                </Button>
                <Button size="sm" variant="primary">
                  Assign an owner
                </Button>
              </React.Fragment>
            )}
          </div>
          <DataTable
            selectable
            selected={sel}
            onSelect={setSel}
            rows={rows}
            columns={[
              { key: "title", header: "Concept" },
              { key: "kind", header: "Kind", render: (r) => <Tag size="sm">{r.kind}</Tag> },
              { key: "domain", header: "Domain" },
              {
                key: "trust",
                header: "Trust",
                render: (r) => <TrustTag size="sm" state={r.state} by={r.by} at={r.at} />,
              },
              { key: "owner", header: "Owner", align: "right" },
            ]}
          />
        </div>
      </div>
    </React.Fragment>
  );
}

function SourcesScreen() {
  const rows = window.BAData.bindings;
  return (
    <React.Fragment>
      <TopBar
        title="Sources"
        meta="Bindings, the publish and accept gates, the priced plan"
        actions={
          <Button size="sm" variant="primary" iconLeft={<Icon name="plus" size={14} />}>
            Add a source
          </Button>
        }
      />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div
          style={{
            padding: "20px 24px 40px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <NotificationBanner
            tone="warning"
            heading="One binding is waiting to publish"
            action={<Button size="sm">Review it</Button>}
          >
            Its chunks and source entities reach nobody outside Control Centre until an Admin
            publishes it.
          </NotificationBanner>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "14px" }}>
            <Card title="2,150" meta="Documents indexed" padding="md" />
            <Card
              title="£1,240.00"
              meta="Extraction spent this month · ceiling £2,000"
              padding="md"
            />
            <Card title="0" meta="Parked bindings" padding="md" />
          </div>
          <DataTable
            rows={rows}
            columns={[
              { key: "name", header: "Binding" },
              {
                key: "connector",
                header: "Connector",
                render: (r) => <Tag size="sm">{r.connector}</Tag>,
              },
              {
                key: "sensitivity",
                header: "Sensitivity",
                render: (r) => (
                  <TrustTag
                    size="sm"
                    state={r.sensitivity === "Restricted" ? "restricted" : "unchecked"}
                  />
                ),
              },
              { key: "docs", header: "Documents", align: "right" },
              { key: "state", header: "State" },
              { key: "run", header: "Last run", align: "right" },
            ]}
          />
          <Details summary="What a binding decides">
            Connector, credential, scope, one domain, sensitivity, audience, cadence, destination
            and retention class.
          </Details>
        </div>
      </div>
    </React.Fragment>
  );
}

function PlaceholderScreen({ name }) {
  return (
    <React.Fragment>
      <TopBar title={name} meta="Control Centre" />
      <EmptyState
        style={{ flex: 1 }}
        icon={<Icon name="bounding-box" size={20} />}
        title={name + " is not recreated in this kit."}
        description="The source repository specifies this screen in CONTEXT.md but ships no interface for it yet. Left deliberately blank rather than invented."
      />
    </React.Fragment>
  );
}

Object.assign(window, { SuggestionsScreen, KnowledgeScreen, SourcesScreen, PlaceholderScreen });
