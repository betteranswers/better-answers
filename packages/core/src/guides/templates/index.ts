import type { GUIDE_LAYERS, ROLE_LABELS, TRUST_TIERS } from "@better-answers/schema";

import type { Role } from "../../kernel/index.ts";
import { BID_LIBRARY } from "./bid-library.ts";

export type GuideLayer = (typeof GUIDE_LAYERS)[number];

export type RoleLabel = (typeof ROLE_LABELS)[number];

type TrustTier = (typeof TRUST_TIERS)[number];

type ExpectedFactTemplate = {
  readonly name: string;
  readonly kind: string;
  readonly tags: readonly string[];
  readonly collection?: string;
  readonly atLeast?: number;
};

export type SectionTemplate = {
  readonly key: string;
  readonly prompt: string;
  readonly roleLabel: RoleLabel;
  readonly usageNote: string | null;
  readonly layers: readonly GuideLayer[];
  readonly hidden: boolean;
  readonly expects: readonly ExpectedFactTemplate[];
  readonly sections: readonly SectionTemplate[];
};

export type TemplateRole = {
  readonly role: Role;
  readonly defaultLayer: GuideLayer;
  readonly actionThreshold: TrustTier;
};

export type Template = {
  readonly id: string;
  readonly kind: string;
  readonly roles: readonly TemplateRole[];
  readonly sections: readonly SectionTemplate[];
};

export const TEMPLATES: ReadonlyMap<string, Template> = new Map([[BID_LIBRARY.id, BID_LIBRARY]]);
