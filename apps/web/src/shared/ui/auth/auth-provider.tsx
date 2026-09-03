import {
  AuthProvider as AuthProviderPrimitive,
  type AuthProviderProps,
} from "@better-auth-ui/react";
import type { ComponentPropsWithoutRef, ComponentType, PropsWithChildren, ReactNode } from "react";

declare module "@better-auth-ui/core" {
  interface AuthConfig {
    /**
     * React component used to render internal navigation links.
     * Typically TanStack Router's `Link` or Next.js's `Link`.
     */
    Link: ComponentType<
      PropsWithChildren<
        { className?: string; href: string; to?: string } & Pick<
          ComponentPropsWithoutRef<"a">,
          "aria-disabled" | "tabIndex" | "onClick"
        >
      >
    >;
  }

  /** Widen `AdditionalField.label` to `ReactNode` in the shadcn package. */
  interface AdditionalFieldRegister {
    label: ReactNode;
  }
}

/**
 * The registry's provider wrapper: the npm primitive plus the `Link` slot below, which is
 * how a component of this library renders an internal link without knowing the router.
 *
 * Upstream also mounts an error toaster over it. That is not taken here (see
 * THIRD_PARTY_NOTICES.md): the screens in this product say what happened inline, beside
 * the control that caused it and inside a live region, and a toast would be a second
 * announcement of the same sentence.
 */
export function AuthProvider({ children, ...config }: AuthProviderProps) {
  return <AuthProviderPrimitive {...config}>{children}</AuthProviderPrimitive>;
}
