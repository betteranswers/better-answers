import {
  ANSWER_MEASURES,
  unmappedPassageRate,
  type UnmappedPassageRate,
} from "@better-answers/core/answering";

import type { Doors } from "../doors.ts";
import { DONE, type OpsIo, refused } from "./cli.ts";

const twoCountsSaid = ({
  flaggedIncomplete,
  showedUnmappedPassages,
}: UnmappedPassageRate["withTheMap"]) => ({
  flagged_incomplete: flaggedIncomplete,
  showed_unmapped_passages: showedUnmappedPassages,
});

export const unmappedPassageRateCommand = async (
  doors: Doors,
  workspaceId: string,
  io: OpsIo,
): Promise<number> => {
  const rate = await unmappedPassageRate(ANSWER_MEASURES, doors.postgres, { workspaceId });
  if (!rate.ok) return refused("unmapped-passage-rate", workspaceId, rate.error, io);
  const { withTheMap, mapUnavailable, mapUnknown } = rate.value;
  io.say(
    JSON.stringify({
      with_the_map: twoCountsSaid(withTheMap),
      map_unavailable: twoCountsSaid(mapUnavailable),
      map_unknown: twoCountsSaid(mapUnknown),
    }),
  );
  return DONE;
};
