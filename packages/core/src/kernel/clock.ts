export type Clock = {
  readonly now: () => Date;
};

export const systemClock = (): Clock => ({ now: () => new Date() });
