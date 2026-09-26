import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/client";
import { emailOTPClient, organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  basePath: "/",
  plugins: [emailOTPClient(), organizationClient(), oauthProviderClient()],
});
