const ACTION = " action";

export const actionAnnotationOf = (action: string): string => `${action}${ACTION}`;

export const actionAnnotatedBy = (type: string): string | undefined =>
  type.endsWith(ACTION) ? type.slice(0, -ACTION.length) : undefined;
