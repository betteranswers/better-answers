export const SCREENS = [
  {
    id: "sources",
    name: "Sources",
    path: "/sources",
    summary:
      "The workspace's source bindings, what each one is allowed to reach, and the gates that publish and accept what it brings in.",
  },
  {
    id: "suggestions",
    name: "Suggestions",
    path: "/suggestions",
    summary: "Every suggestion waiting on a decision, in one queue.",
  },
  {
    id: "knowledge",
    name: "Knowledge",
    path: "/knowledge",
    summary:
      "The review table over every concept and composition on the workspace's map, with its conflicts and its verification requests.",
  },
  {
    id: "questions",
    name: "Questions",
    path: "/questions",
    summary: "The answer audit — every question the workspace asked, the flagged ones first.",
  },
  {
    id: "people",
    name: "People",
    path: "/people",
    summary: "The workspace's members and their roles, with owners, thresholds and tokens.",
  },
  {
    id: "system",
    name: "System",
    path: "/system",
    summary: "Signals, health, routes and spend, and backups.",
  },
] as const;

export type Screen = (typeof SCREENS)[number];
export type ScreenId = Screen["id"];

export const screenById = (id: ScreenId): Screen => {
  const screen = SCREENS.find((candidate) => candidate.id === id);
  if (screen === undefined) throw new Error(`no screen is named ${id}`);
  return screen;
};
