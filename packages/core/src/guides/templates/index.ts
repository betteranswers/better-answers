import { BID_LIBRARY } from "./bid-library.ts";
import type { Template } from "./template.ts";

export type { GuideLayer, RoleLabel, SectionTemplate, Template, TemplateRole } from "./template.ts";

export const TEMPLATES: ReadonlyMap<string, Template> = new Map([[BID_LIBRARY.id, BID_LIBRARY]]);
