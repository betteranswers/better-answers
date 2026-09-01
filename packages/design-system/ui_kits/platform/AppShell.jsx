const { SideNav, Badge, Icon, IconButton, Tooltip, GridPattern } = window.BADS;

function TopBar({ title, meta, actions }) {
  return (
    <header
      style={{
        height: "var(--topbar-h)",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "0 20px",
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--surface-card)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: 0, flex: 1 }}>
        <h1
          style={{
            margin: 0,
            fontSize: "var(--text-md)",
            fontWeight: "var(--weight-semibold)",
            letterSpacing: "var(--tracking-heading)",
            color: "var(--text-primary)",
          }}
        >
          {title}
        </h1>
        {meta && (
          <p style={{ margin: 0, fontSize: "var(--text-2xs)", color: "var(--text-muted)" }}>
            {meta}
          </p>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        {actions}
        <Tooltip label="Keyboard shortcuts  ?" side="bottom">
          <IconButton label="Keyboard shortcuts">
            <Icon name="keyboard" />
          </IconButton>
        </Tooltip>
      </div>
    </header>
  );
}

function Wordmark() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      <span
        style={{
          fontSize: "var(--text-md)",
          fontWeight: "var(--weight-semibold)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "-0.02em",
          color: "var(--text-primary)",
        }}
      >
        better-answers
      </span>
      <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-muted)" }}>
        {window.BAData.workspace}
      </span>
    </div>
  );
}

function AppShell({ screen, setScreen, children }) {
  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        background: "var(--surface-page)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <SideNav
        value={screen}
        onChange={setScreen}
        header={<Wordmark />}
        footer={
          <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-faint)" }}>
            Map as of {window.BAData.mapAsOf}
          </span>
        }
        sections={[
          {
            items: [
              { value: "ask", label: "Ask", icon: <Icon name="chat-text" /> },
              { value: "search", label: "Search", icon: <Icon name="magnifying-glass" /> },
              { value: "guide", label: "Guides", icon: <Icon name="book-open" /> },
            ],
          },
          {
            label: "Control Centre",
            items: [
              { value: "sources", label: "Sources", icon: <Icon name="database" /> },
              {
                value: "suggestions",
                label: "Suggestions",
                icon: <Icon name="tray" />,
                trailing: <Badge count={4} />,
              },
              { value: "knowledge", label: "Knowledge", icon: <Icon name="graph" /> },
              {
                value: "questions",
                label: "Questions",
                icon: <Icon name="question" />,
                trailing: <Badge count={3} tone="danger" />,
              },
              { value: "people", label: "People", icon: <Icon name="users" /> },
              { value: "system", label: "System", icon: <Icon name="pulse" /> },
            ],
          },
        ]}
      />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        <GridPattern width={32} height={32} style={{ zIndex: 0 }} />
        <div
          style={{
            position: "relative",
            zIndex: 1,
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

Object.assign(window, { AppShell, TopBar, Wordmark });
