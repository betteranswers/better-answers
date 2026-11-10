import { screen, within } from "@testing-library/react";

import { UNKNOWN_PAGE } from "@/app/words.ts";

import { adaAnAdmin, aRefusalAnswer, openAt } from "../two-workspaces.ts";

export const openedWhereTheApiNamesNone = async (path: string, procedure: string) => {
  const api = adaAnAdmin();
  api.set(procedure, () => aRefusalAnswer("not-found", "not-found", 404));
  await openAt(path, api);

  return {
    notFound: await screen.findByRole("heading", { level: 1, name: UNKNOWN_PAGE.heading }),
    alerts: within(screen.getByRole("main")).queryAllByRole("alert"),
  };
};
