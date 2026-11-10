import { screen, within } from "@testing-library/react";
import { expect } from "vitest";

import { goHome, UNKNOWN_PAGE } from "@/app/words.ts";
import type { Page } from "@/shared/navigation.ts";

import { adaAnAdmin, aRefusalAnswer, openAt } from "./two-workspaces.ts";

export const openedWhereTheApiNamesNone = async (path: string, procedure: string) => {
  const api = adaAnAdmin();
  api.set(procedure, () => aRefusalAnswer("not-found", "not-found", 404));
  await openAt(path, api);

  return {
    notFound: await screen.findByRole("heading", { level: 1, name: UNKNOWN_PAGE.heading }),
    alerts: within(screen.getByRole("main")).queryAllByRole("alert"),
  };
};

export const notFoundLinksHome = async (home: Page): Promise<void> => {
  expect(
    await screen.findByRole("heading", { level: 1, name: UNKNOWN_PAGE.heading }),
  ).toBeDefined();
  expect(screen.getByRole("link", { name: goHome(home) })).toBeDefined();
};
